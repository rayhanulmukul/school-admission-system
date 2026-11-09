using Microsoft.EntityFrameworkCore;
using SchoolAdmission.Api.Contracts;
using SchoolAdmission.Api.Data;
using SchoolAdmission.Api.Models;

namespace SchoolAdmission.Api.Services;

public sealed class AdmissionService(
    AdmissionDbContext db,
    TimeProvider timeProvider,
    TimeSpan holdDuration)
{
    public async Task<ClassResponse> CreateClassAsync(
        CreateClassRequest request,
        CancellationToken cancellationToken)
    {
        var admissionClass = new AdmissionClass
        {
            Id = $"c_{Guid.NewGuid():N}",
            Name = request.Name.Trim(),
            TotalSeats = request.TotalSeats,
            AdmissionFee = request.AdmissionFee
        };

        db.Classes.Add(admissionClass);
        await db.SaveChangesAsync(cancellationToken);

        return ToClassResponse(admissionClass, 0, 0);
    }

    public async Task<IReadOnlyList<ClassResponse>> GetClassesAsync(
        CancellationToken cancellationToken)
    {
        var classes = await db.Classes
            .AsNoTracking()
            .OrderBy(admissionClass => admissionClass.Name)
            .ToListAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var counts = await db.Holds
            .AsNoTracking()
            .Where(hold => hold.Status == HoldStatus.Confirmed
                || (hold.Status == HoldStatus.Held && hold.ExpiresAt > now))
            .GroupBy(hold => hold.ClassId)
            .Select(group => new
            {
                ClassId = group.Key,
                HeldSeats = group.Count(hold => hold.Status == HoldStatus.Held),
                ConfirmedSeats = group.Count(hold => hold.Status == HoldStatus.Confirmed)
            })
            .ToDictionaryAsync(group => group.ClassId, cancellationToken);

        return classes.Select(admissionClass =>
        {
            counts.TryGetValue(admissionClass.Id, out var count);
            return ToClassResponse(
                admissionClass,
                count?.HeldSeats ?? 0,
                count?.ConfirmedSeats ?? 0);
        }).ToArray();
    }

    public async Task<ClassResponse?> GetClassAsync(
        string classId,
        CancellationToken cancellationToken)
    {
        var admissionClass = await db.Classes
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == classId, cancellationToken);

        if (admissionClass is null)
        {
            return null;
        }

        var now = timeProvider.GetUtcNow();
        var holds = await db.Holds
            .AsNoTracking()
            .Where(hold => hold.ClassId == classId
                && (hold.Status == HoldStatus.Confirmed
                    || (hold.Status == HoldStatus.Held && hold.ExpiresAt > now)))
            .GroupBy(hold => hold.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToDictionaryAsync(group => group.Status, group => group.Count, cancellationToken);

        return ToClassResponse(
            admissionClass,
            holds.GetValueOrDefault(HoldStatus.Held),
            holds.GetValueOrDefault(HoldStatus.Confirmed));
    }

    public async Task<HoldResponse?> CreateHoldAsync(
        string classId,
        string studentId,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var admissionClass = await db.Classes
            .FromSqlInterpolated($"SELECT * FROM \"Classes\" WHERE \"Id\" = {classId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

        if (admissionClass is null)
        {
            return null;
        }

        var now = timeProvider.GetUtcNow();
        await ExpireClassHoldsAsync(classId, now, cancellationToken);

        var existingHold = await db.Holds.AnyAsync(
            hold => hold.ClassId == classId
                && hold.StudentId == studentId
                && (hold.Status == HoldStatus.Confirmed || hold.Status == HoldStatus.Held),
            cancellationToken);
        if (existingHold)
        {
            throw new AdmissionConflictException(
                "This student already has an active hold or confirmed seat for this class.");
        }

        var occupiedSeats = await db.Holds.CountAsync(
            hold => hold.ClassId == classId
                && (hold.Status == HoldStatus.Confirmed
                    || (hold.Status == HoldStatus.Held && hold.ExpiresAt > now)),
            cancellationToken);
        if (occupiedSeats >= admissionClass.TotalSeats)
        {
            throw new AdmissionConflictException("No seats are currently available.");
        }

        var hold = new SeatHold
        {
            Id = $"h_{Guid.NewGuid():N}",
            ClassId = classId,
            StudentId = studentId,
            Status = HoldStatus.Held,
            CreatedAt = now,
            ExpiresAt = now.Add(holdDuration)
        };

        db.Holds.Add(hold);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ToHoldResponse(hold);
    }

    public async Task<HoldResponse?> GetHoldAsync(
        string holdId,
        CancellationToken cancellationToken)
    {
        var hold = await db.Holds
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == holdId, cancellationToken);
        if (hold is null)
        {
            return null;
        }

        hold = await RefreshExpirationAsync(hold, cancellationToken);
        return ToHoldResponse(hold);
    }

    public async Task<ConfirmHoldResponse?> ConfirmHoldAsync(
        string holdId,
        string studentId,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var holdSnapshot = await db.Holds.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == holdId, cancellationToken);
        if (holdSnapshot is null)
        {
            return null;
        }

        await LockClassAsync(holdSnapshot.ClassId, cancellationToken);
        var hold = await db.Holds.SingleOrDefaultAsync(
            item => item.Id == holdId, cancellationToken);
        if (hold is null)
        {
            return null;
        }

        if (hold.StudentId != studentId)
        {
            throw new AdmissionForbiddenException(
                "This hold belongs to a different student.");
        }

        var now = timeProvider.GetUtcNow();
        if (hold.Status == HoldStatus.Held && hold.ExpiresAt <= now)
        {
            hold.Status = HoldStatus.Expired;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            throw new AdmissionConflictException("This seat hold has expired.");
        }

        if (hold.Status != HoldStatus.Held)
        {
            throw new AdmissionConflictException(
                $"A hold with status {hold.Status} cannot be confirmed.");
        }

        hold.Status = HoldStatus.Confirmed;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new ConfirmHoldResponse(hold.Id, hold.Status);
    }

    public async Task CancelHoldAsync(
        string holdId,
        string studentId,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var holdSnapshot = await db.Holds.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == holdId, cancellationToken);
        if (holdSnapshot is null)
        {
            throw new AdmissionNotFoundException("The requested hold was not found.");
        }

        await LockClassAsync(holdSnapshot.ClassId, cancellationToken);
        var hold = await db.Holds.SingleOrDefaultAsync(
            item => item.Id == holdId, cancellationToken);
        if (hold is null)
        {
            throw new AdmissionNotFoundException("The requested hold was not found.");
        }

        if (hold.StudentId != studentId)
        {
            throw new AdmissionForbiddenException(
                "This hold belongs to a different student.");
        }

        if (hold.Status == HoldStatus.Held && hold.ExpiresAt <= timeProvider.GetUtcNow())
        {
            hold.Status = HoldStatus.Expired;
        }
        else if (hold.Status == HoldStatus.Held)
        {
            hold.Status = HoldStatus.Cancelled;
        }
        else if (hold.Status != HoldStatus.Cancelled)
        {
            throw new AdmissionConflictException(
                $"A hold with status {hold.Status} cannot be cancelled.");
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StudentHoldResponse>> GetStudentHoldsAsync(
        string studentId,
        CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        await db.Holds
            .Where(hold => hold.StudentId == studentId
                && hold.Status == HoldStatus.Held
                && hold.ExpiresAt <= now)
            .ExecuteUpdateAsync(
                updates => updates.SetProperty(hold => hold.Status, HoldStatus.Expired),
                cancellationToken);

        return await db.Holds
            .AsNoTracking()
            .Where(hold => hold.StudentId == studentId)
            .OrderByDescending(hold => hold.CreatedAt)
            .Select(hold => new StudentHoldResponse(
                hold.Id,
                hold.ClassId,
                hold.Class.Name,
                hold.Class.AdmissionFee,
                hold.Status,
                hold.ExpiresAt))
            .ToListAsync(cancellationToken);
    }

    private async Task LockClassAsync(string classId, CancellationToken cancellationToken)
    {
        await db.Classes
            .FromSqlInterpolated($"SELECT * FROM \"Classes\" WHERE \"Id\" = {classId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
    }

    private Task<int> ExpireClassHoldsAsync(
        string classId,
        DateTimeOffset now,
        CancellationToken cancellationToken) =>
        db.Holds
            .Where(hold => hold.ClassId == classId
                && hold.Status == HoldStatus.Held
                && hold.ExpiresAt <= now)
            .ExecuteUpdateAsync(
                updates => updates.SetProperty(hold => hold.Status, HoldStatus.Expired),
                cancellationToken);

    private async Task<SeatHold> RefreshExpirationAsync(
        SeatHold hold,
        CancellationToken cancellationToken)
    {
        if (hold.Status != HoldStatus.Held || hold.ExpiresAt > timeProvider.GetUtcNow())
        {
            return hold;
        }

        await db.Holds
            .Where(item => item.Id == hold.Id && item.Status == HoldStatus.Held)
            .ExecuteUpdateAsync(
                updates => updates.SetProperty(item => item.Status, HoldStatus.Expired),
                cancellationToken);
        hold.Status = HoldStatus.Expired;
        return hold;
    }

    private static ClassResponse ToClassResponse(
        AdmissionClass admissionClass,
        int heldSeats,
        int confirmedSeats) =>
        new(
            admissionClass.Id,
            admissionClass.Name,
            admissionClass.TotalSeats,
            admissionClass.AdmissionFee,
            heldSeats,
            confirmedSeats,
            admissionClass.TotalSeats - heldSeats - confirmedSeats);

    private static HoldResponse ToHoldResponse(SeatHold hold) =>
        new(hold.Id, hold.ClassId, hold.StudentId, hold.Status, hold.ExpiresAt);
}

public sealed class AdmissionConflictException(string message) : Exception(message);

public sealed class AdmissionForbiddenException(string message) : Exception(message);

public sealed class AdmissionNotFoundException(string message) : Exception(message);
