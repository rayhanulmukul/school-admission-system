using System.ComponentModel.DataAnnotations;
using SchoolAdmission.Api.Models;

namespace SchoolAdmission.Api.Contracts;

public sealed class CreateClassRequest
{
    [Required]
    [StringLength(120, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [Range(1, 10000)]
    public int TotalSeats { get; init; }

    [Range(typeof(decimal), "0", "9999999999.99")]
    public decimal AdmissionFee { get; init; }
}

public sealed record ClassResponse(
    string Id,
    string Name,
    int TotalSeats,
    decimal AdmissionFee,
    int HeldSeats,
    int ConfirmedSeats,
    int AvailableSeats);

public sealed record HoldResponse(
    string HoldId,
    string ClassId,
    string StudentId,
    HoldStatus Status,
    DateTimeOffset ExpiresAt);

public sealed record StudentHoldResponse(
    string HoldId,
    string ClassId,
    string ClassName,
    decimal AdmissionFee,
    HoldStatus Status,
    DateTimeOffset ExpiresAt);

public sealed record ConfirmHoldResponse(string HoldId, HoldStatus Status);
