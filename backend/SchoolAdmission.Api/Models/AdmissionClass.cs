namespace SchoolAdmission.Api.Models;

public sealed class AdmissionClass
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int TotalSeats { get; set; }
    public decimal AdmissionFee { get; set; }
    public List<SeatHold> Holds { get; set; } = [];
}
