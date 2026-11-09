using Microsoft.AspNetCore.Mvc;
using SchoolAdmission.Api.Contracts;
using SchoolAdmission.Api.Services;

namespace SchoolAdmission.Api.Controllers;

[ApiController]
[Route("holds")]
public sealed class HoldsController(AdmissionService admissionService) : ControllerBase
{
    [HttpGet("{holdId}")]
    public async Task<ActionResult<HoldResponse>> Get(
        string holdId,
        CancellationToken cancellationToken)
    {
        var response = await admissionService.GetHoldAsync(holdId, cancellationToken);
        return response is null ? NotFound() : Ok(response);
    }

    [HttpPost("{holdId}/confirm")]
    public async Task<ActionResult<ConfirmHoldResponse>> Confirm(
        string holdId,
        [FromHeader(Name = "X-Student-Id")] string? studentId,
        CancellationToken cancellationToken)
    {
        var validatedStudentId = ValidateStudentId(studentId);
        if (validatedStudentId is null)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Missing student ID",
                Detail = "Provide a student ID in the X-Student-Id header.",
                Status = StatusCodes.Status400BadRequest
            });
        }

        var response = await admissionService.ConfirmHoldAsync(
            holdId, validatedStudentId, cancellationToken);
        return response is null ? NotFound() : Ok(response);
    }

    [HttpDelete("{holdId}")]
    public async Task<IActionResult> Cancel(
        string holdId,
        [FromHeader(Name = "X-Student-Id")] string? studentId,
        CancellationToken cancellationToken)
    {
        var validatedStudentId = ValidateStudentId(studentId);
        if (validatedStudentId is null)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Missing student ID",
                Detail = "Provide a student ID in the X-Student-Id header.",
                Status = StatusCodes.Status400BadRequest
            });
        }

        await admissionService.CancelHoldAsync(
            holdId, validatedStudentId, cancellationToken);
        return NoContent();
    }

    private static string? ValidateStudentId(string? studentId)
    {
        var normalized = studentId?.Trim();
        return string.IsNullOrEmpty(normalized) || normalized.Length > 80
            ? null
            : normalized;
    }
}
