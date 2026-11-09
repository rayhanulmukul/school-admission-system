using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.Json.Serialization;
using SchoolAdmission.Api.Data;
using SchoolAdmission.Api.Services;

var builder = WebApplication.CreateBuilder(args);

var connectionString =
    builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException(
        "Database connection string is missing.");

var holdDurationSeconds = builder.Configuration.GetValue(
    "HOLD_DURATION_SECONDS", 600);
if (holdDurationSeconds <= 0)
{
    throw new InvalidOperationException(
        "HOLD_DURATION_SECONDS must be greater than zero.");
}

builder.Services.AddDbContext<AdmissionDbContext>(options =>
    options.UseNpgsql(connectionString));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped(provider => new AdmissionService(
    provider.GetRequiredService<AdmissionDbContext>(),
    provider.GetRequiredService<TimeProvider>(),
    TimeSpan.FromSeconds(holdDurationSeconds)));
builder.Services.AddControllers().AddJsonOptions(options =>
    options.JsonSerializerOptions.Converters.Add(
        new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper)));
builder.Services.AddOpenApi();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(builder.Configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>() ?? [
                "http://localhost:5173",
                "http://localhost:8081",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:8081"
            ])
        .AllowAnyHeader()
        .AllowAnyMethod()));

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AdmissionDbContext>();
    await db.Database.EnsureCreatedAsync();
    await db.Database.ExecuteSqlRawAsync(
        """ALTER TABLE "Classes" ADD COLUMN IF NOT EXISTS "AdmissionFee" numeric(12,2) NOT NULL DEFAULT 0""");
}

app.MapOpenApi();

app.UseExceptionHandler(exceptionHandler => exceptionHandler.Run(async context =>
{
    var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    var (status, title) = exception switch
    {
        AdmissionConflictException => (StatusCodes.Status409Conflict, "Conflict"),
        AdmissionForbiddenException => (StatusCodes.Status403Forbidden, "Forbidden"),
        AdmissionNotFoundException => (StatusCodes.Status404NotFound, "Not found"),
        _ => (StatusCodes.Status500InternalServerError, "An unexpected error occurred")
    };

    if (status == StatusCodes.Status500InternalServerError)
    {
        context.RequestServices.GetRequiredService<ILogger<Program>>()
            .LogError(exception, "Unhandled error while processing {Path}", context.Request.Path);
    }

    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(new ProblemDetails
    {
        Status = status,
        Title = title,
        Detail = status == StatusCodes.Status500InternalServerError
            ? null
            : exception?.Message
    });
}));

app.UseCors();
app.UseHttpsRedirection();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

public partial class Program;
