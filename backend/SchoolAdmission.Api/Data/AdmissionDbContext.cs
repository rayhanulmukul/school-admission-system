using Microsoft.EntityFrameworkCore;
using SchoolAdmission.Api.Models;

namespace SchoolAdmission.Api.Data;

public sealed class AdmissionDbContext(
    DbContextOptions<AdmissionDbContext> options) : DbContext(options)
{
    public DbSet<AdmissionClass> Classes => Set<AdmissionClass>();
    public DbSet<SeatHold> Holds => Set<SeatHold>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AdmissionClass>(entity =>
        {
            entity.HasKey(admissionClass => admissionClass.Id);
            entity.Property(admissionClass => admissionClass.Id).HasMaxLength(40);
            entity.Property(admissionClass => admissionClass.Name)
                .HasMaxLength(120)
                .IsRequired();
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Classes_TotalSeats", "\"TotalSeats\" > 0"));
        });

        modelBuilder.Entity<SeatHold>(entity =>
        {
            entity.HasKey(hold => hold.Id);
            entity.Property(hold => hold.Id).HasMaxLength(40);
            entity.Property(hold => hold.StudentId).HasMaxLength(80).IsRequired();
            entity.Property(hold => hold.Status).HasConversion<string>().HasMaxLength(16);
            entity.HasIndex(hold => new { hold.ClassId, hold.Status, hold.ExpiresAt });
            entity.HasIndex(hold => new { hold.StudentId, hold.CreatedAt });
            entity.HasOne(hold => hold.Class)
                .WithMany(admissionClass => admissionClass.Holds)
                .HasForeignKey(hold => hold.ClassId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
