using System.ComponentModel.DataAnnotations;
using SchoolAdmission.Api.Models;

namespace SchoolAdmission.Api.Contracts;

public sealed record CreateClassRequest(
    [property: Required]
    [property: StringLength(120, MinimumLength = 1)]
    string Name,
    [property: Range(1, 10000)]
    int TotalSeats);

public sealed record ClassResponse(
    string Id,
    string Name,
    int TotalSeats,
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
    HoldStatus Status,
    DateTimeOffset ExpiresAt);

public sealed record ConfirmHoldResponse(string HoldId, HoldStatus Status);
