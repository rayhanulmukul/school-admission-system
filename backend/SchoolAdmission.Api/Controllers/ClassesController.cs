using Microsoft.AspNetCore.Mvc;
using SchoolAdmission.Api.Contracts;
using SchoolAdmission.Api.Services;

namespace SchoolAdmission.Api.Controllers;

[ApiController]
[Route("classes")]
public sealed class ClassesController(AdmissionService admissionService) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ClassResponse>> Create(
        CreateClassRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid class name",
                Detail = "A non-empty class name is required.",
                Status = StatusCodes.Status400BadRequest
            });
        }

        var response = await admissionService.CreateClassAsync(request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { classId = response.Id }, response);
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ClassResponse>>> List(
        CancellationToken cancellationToken) =>
        Ok(await admissionService.GetClassesAsync(cancellationToken));

    [HttpGet("{classId}")]
    public async Task<ActionResult<ClassResponse>> Get(
        string classId,
        CancellationToken cancellationToken)
    {
        var response = await admissionService.GetClassAsync(classId, cancellationToken);
        return response is null ? NotFound() : Ok(response);
    }

    [HttpPost("{classId}/holds")]
    public async Task<ActionResult<HoldResponse>> CreateHold(
        string classId,
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

        var response = await admissionService.CreateHoldAsync(
            classId, validatedStudentId, cancellationToken);
        return response is null
            ? NotFound()
            : StatusCode(StatusCodes.Status201Created, response);
    }

    private static string? ValidateStudentId(string? studentId)
    {
        var normalized = studentId?.Trim();
        return string.IsNullOrEmpty(normalized) || normalized.Length > 80
            ? null
            : normalized;
    }
}
