using Microsoft.AspNetCore.Mvc;
using SchoolAdmission.Api.Contracts;
using SchoolAdmission.Api.Services;

namespace SchoolAdmission.Api.Controllers;

[ApiController]
[Route("me")]
public sealed class MeController(AdmissionService admissionService) : ControllerBase
{
    [HttpGet("holds")]
    public async Task<ActionResult<IReadOnlyList<StudentHoldResponse>>> GetHolds(
        [FromHeader(Name = "X-Student-Id")] string? studentId,
        CancellationToken cancellationToken)
    {
        var normalized = studentId?.Trim();
        if (string.IsNullOrEmpty(normalized) || normalized.Length > 80)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Missing student ID",
                Detail = "Provide a student ID in the X-Student-Id header.",
                Status = StatusCodes.Status400BadRequest
            });
        }

        return Ok(await admissionService.GetStudentHoldsAsync(normalized, cancellationToken));
    }
}
