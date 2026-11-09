using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;

namespace SchoolAdmission.Api.Tests;

[Collection(AdmissionApiCollection.Name)]
public sealed class AdmissionApiTests(AdmissionApiFixture fixture)
{
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task CreateClass_ListsAndReturnsSeatCounts()
    {
        var admissionClass = await CreateClassAsync("Class 6 - Morning Shift", 3, 1500m);

        var heldResponse = await CreateHoldAsync(admissionClass.Id, "student-a");
        Assert.Equal(HttpStatusCode.Created, heldResponse.StatusCode);

        var classes = await fixture.Client.GetFromJsonAsync<ClassResponse[]>(
            "/classes", JsonOptions);
        var listedClass = Assert.Single(classes!, item => item.Id == admissionClass.Id);
        Assert.Equal(1, listedClass.HeldSeats);
        Assert.Equal(0, listedClass.ConfirmedSeats);
        Assert.Equal(2, listedClass.AvailableSeats);
        Assert.Equal(1500m, listedClass.AdmissionFee);

        var details = await fixture.Client.GetFromJsonAsync<ClassResponse>(
            $"/classes/{admissionClass.Id}", JsonOptions);
        Assert.NotNull(details);
        Assert.Equal(3, details.TotalSeats);
        Assert.Equal(1, details.HeldSeats);
        Assert.Equal(1500m, details.AdmissionFee);
    }

    [Fact]
    public async Task CreateClass_RejectsBlankNamesAndInvalidSeatCounts()
    {
        var blankNameResponse = await fixture.Client.PostAsJsonAsync(
            "/classes", new { name = "   ", totalSeats = 2 });
        var invalidSeatCountResponse = await fixture.Client.PostAsJsonAsync(
            "/classes", new { name = "Class 5 - Morning Shift", totalSeats = 0 });

        Assert.Equal(HttpStatusCode.BadRequest, blankNameResponse.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalidSeatCountResponse.StatusCode);
    }

    [Fact]
    public async Task Hold_BlocksSecondClassWhileStudentHasActiveApplication()
    {
        var firstClass = await CreateClassAsync("Class 9 - Morning Shift", 5);
        var secondClass = await CreateClassAsync("Class 10 - Day Shift", 5);

        Assert.Equal(
            HttpStatusCode.Created,
            (await CreateHoldAsync(firstClass.Id, "student-multi")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Conflict,
            (await CreateHoldAsync(secondClass.Id, "student-multi")).StatusCode);
    }

    [Fact]
    public async Task ConfirmHold_UpdatesStudentHistoryAndSeatCounts()
    {
        var admissionClass = await CreateClassAsync("Class 7 - Day Shift", 1);
        var holdResponse = await CreateHoldAsync(admissionClass.Id, "student-b");
        var hold = await holdResponse.Content.ReadFromJsonAsync<HoldResponse>(JsonOptions);
        Assert.NotNull(hold);
        Assert.Equal("HELD", hold.Status);

        using var confirmRequest = new HttpRequestMessage(
            HttpMethod.Post, $"/holds/{hold.HoldId}/confirm");
        confirmRequest.Headers.Add("X-Student-Id", "student-b");
        var confirmResponse = await fixture.Client.SendAsync(confirmRequest);

        Assert.Equal(HttpStatusCode.OK, confirmResponse.StatusCode);
        var confirmed = await confirmResponse.Content.ReadFromJsonAsync<HoldResponse>(JsonOptions);
        Assert.NotNull(confirmed);
        Assert.Equal("CONFIRMED", confirmed.Status);

        var studentHolds = await GetStudentHoldsAsync("student-b");
        var studentHold = Assert.Single(studentHolds);
        Assert.Equal("CONFIRMED", studentHold.Status);
        Assert.Equal(0m, studentHold.AdmissionFee);

        var classDetails = await fixture.Client.GetFromJsonAsync<ClassResponse>(
            $"/classes/{admissionClass.Id}", JsonOptions);
        Assert.NotNull(classDetails);
        Assert.Equal(0, classDetails.AvailableSeats);
        Assert.Equal(1, classDetails.ConfirmedSeats);
    }

    [Fact]
    public async Task Hold_RejectsFullClassDuplicateStudentAndMissingStudentId()
    {
        var admissionClass = await CreateClassAsync("Class 8 - Morning Shift", 1);

        Assert.Equal(
            HttpStatusCode.Created,
            (await CreateHoldAsync(admissionClass.Id, "student-c")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Conflict,
            (await CreateHoldAsync(admissionClass.Id, "student-c")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Conflict,
            (await CreateHoldAsync(admissionClass.Id, "student-d")).StatusCode);

        using var missingStudentRequest = new HttpRequestMessage(
            HttpMethod.Post, $"/classes/{admissionClass.Id}/holds");
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await fixture.Client.SendAsync(missingStudentRequest)).StatusCode);
    }

    [Fact]
    public async Task ConfirmHold_OnlyAllowsTheOwningStudent()
    {
        var admissionClass = await CreateClassAsync("Class 9 - Day Shift", 1);
        var holdResponse = await CreateHoldAsync(admissionClass.Id, "student-owner");
        var hold = await holdResponse.Content.ReadFromJsonAsync<HoldResponse>(JsonOptions);
        Assert.NotNull(hold);

        using var confirmRequest = new HttpRequestMessage(
            HttpMethod.Post, $"/holds/{hold.HoldId}/confirm");
        confirmRequest.Headers.Add("X-Student-Id", "another-student");

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await fixture.Client.SendAsync(confirmRequest)).StatusCode);
    }

    [Fact]
    public async Task CancelHold_ReleasesSeatForAnotherStudent()
    {
        var admissionClass = await CreateClassAsync("Class 10 - Morning Shift", 1);
        var holdResponse = await CreateHoldAsync(admissionClass.Id, "student-e");
        var hold = await holdResponse.Content.ReadFromJsonAsync<HoldResponse>(JsonOptions);
        Assert.NotNull(hold);

        using var cancelRequest = new HttpRequestMessage(
            HttpMethod.Delete, $"/holds/{hold.HoldId}");
        cancelRequest.Headers.Add("X-Student-Id", "student-e");
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await fixture.Client.SendAsync(cancelRequest)).StatusCode);

        var cancelledHold = await fixture.Client.GetFromJsonAsync<HoldResponse>(
            $"/holds/{hold.HoldId}", JsonOptions);
        Assert.NotNull(cancelledHold);
        Assert.Equal("CANCELLED", cancelledHold.Status);

        Assert.Equal(
            HttpStatusCode.Created,
            (await CreateHoldAsync(admissionClass.Id, "student-f")).StatusCode);
    }

    [Fact]
    public async Task ExpiredHold_IsMarkedExpiredAndNoLongerOccupiesASeat()
    {
        var admissionClass = await CreateClassAsync("Class 11 - Day Shift", 1);
        var holdResponse = await CreateHoldAsync(admissionClass.Id, "student-g");
        var hold = await holdResponse.Content.ReadFromJsonAsync<HoldResponse>(JsonOptions);
        Assert.NotNull(hold);

        await using (var connection = new NpgsqlConnection(fixture.TestConnectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText =
                "UPDATE \"Holds\" SET \"ExpiresAt\" = NOW() - INTERVAL '1 minute' WHERE \"Id\" = @holdId";
            command.Parameters.AddWithValue("holdId", hold.HoldId);
            Assert.Equal(1, await command.ExecuteNonQueryAsync());
        }

        var expiredHold = await fixture.Client.GetFromJsonAsync<HoldResponse>(
            $"/holds/{hold.HoldId}", JsonOptions);
        Assert.NotNull(expiredHold);
        Assert.Equal("EXPIRED", expiredHold.Status);
        Assert.Equal(
            HttpStatusCode.Created,
            (await CreateHoldAsync(admissionClass.Id, "student-h")).StatusCode);
    }

    [Fact]
    public async Task ConcurrentHoldRequests_NeverExceedClassCapacity()
    {
        const int capacity = 4;
        const int requestCount = 24;
        var admissionClass = await CreateClassAsync("Class 12 - Morning Shift", capacity);

        var requests = Enumerable.Range(0, requestCount)
            .Select(index => CreateHoldAsync(admissionClass.Id, $"student-{index}"));
        var responses = await Task.WhenAll(requests);

        Assert.Equal(
            capacity,
            responses.Count(response => response.StatusCode == HttpStatusCode.Created));
        Assert.Equal(
            requestCount - capacity,
            responses.Count(response => response.StatusCode == HttpStatusCode.Conflict));

        var details = await fixture.Client.GetFromJsonAsync<ClassResponse>(
            $"/classes/{admissionClass.Id}", JsonOptions);
        Assert.NotNull(details);
        Assert.Equal(capacity, details.HeldSeats + details.ConfirmedSeats);
        Assert.Equal(0, details.AvailableSeats);
    }

    private async Task<ClassResponse> CreateClassAsync(
        string name,
        int totalSeats,
        decimal admissionFee = 0)
    {
        var response = await fixture.Client.PostAsJsonAsync(
            "/classes", new { name, totalSeats, admissionFee });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var admissionClass = await response.Content.ReadFromJsonAsync<ClassResponse>(JsonOptions);
        Assert.NotNull(admissionClass);
        return admissionClass;
    }

    private async Task<HttpResponseMessage> CreateHoldAsync(string classId, string studentId)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"/classes/{classId}/holds");
        request.Headers.Add("X-Student-Id", studentId);
        return await fixture.Client.SendAsync(request);
    }

    private async Task<StudentHoldResponse[]> GetStudentHoldsAsync(string studentId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/me/holds");
        request.Headers.Add("X-Student-Id", studentId);
        var response = await fixture.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<StudentHoldResponse[]>(JsonOptions))!;
    }

    private sealed record ClassResponse(
        string Id,
        string Name,
        int TotalSeats,
        decimal AdmissionFee,
        int HeldSeats,
        int ConfirmedSeats,
        int AvailableSeats);

    private sealed record HoldResponse(
        string HoldId,
        string ClassId,
        string StudentId,
        string Status,
        DateTimeOffset ExpiresAt);

    private sealed record StudentHoldResponse(
        string HoldId,
        string ClassId,
        string ClassName,
        decimal AdmissionFee,
        string Status,
        DateTimeOffset ExpiresAt);
}
