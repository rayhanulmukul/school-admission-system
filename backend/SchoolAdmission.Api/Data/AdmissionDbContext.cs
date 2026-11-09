using Microsoft.EntityFrameworkCore;

namespace SchoolAdmission.Api.Data;

public sealed class AdmissionDbContext(
    DbContextOptions<AdmissionDbContext> options) : DbContext(options)
{
}
