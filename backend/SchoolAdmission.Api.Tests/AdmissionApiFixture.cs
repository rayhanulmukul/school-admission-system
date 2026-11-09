using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace SchoolAdmission.Api.Tests;

public sealed class AdmissionApiFixture : IAsyncLifetime
{
    private readonly string _adminConnectionString =
        Environment.GetEnvironmentVariable("ADMISSION_TEST_CONNECTION")
        ?? "Host=localhost;Port=5432;Database=school_admission;Username=school_app;Password=local_dev_password";
    private TestApiFactory? _factory;
    private HttpClient? _client;
    private string? _databaseName;
    private string? _originalConnectionString;
    private string? _originalHoldDuration;

    public HttpClient Client =>
        _client ?? throw new InvalidOperationException("The test API client was not initialized.");
    public string TestConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        _databaseName = $"admission_test_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(_adminConnectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{_databaseName}\"";
            await command.ExecuteNonQueryAsync();
        }

        var connectionStringBuilder = new NpgsqlConnectionStringBuilder(_adminConnectionString)
        {
            Database = _databaseName
        };
        TestConnectionString = connectionStringBuilder.ConnectionString;
        _originalConnectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");
        _originalHoldDuration = Environment.GetEnvironmentVariable("HOLD_DURATION_SECONDS");
        Environment.SetEnvironmentVariable(
            "ConnectionStrings__DefaultConnection", TestConnectionString);
        Environment.SetEnvironmentVariable("HOLD_DURATION_SECONDS", "60");

        _factory = new TestApiFactory(TestConnectionString);
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();
        if (_factory is not null)
        {
            await _factory.DisposeAsync();
        }

        Environment.SetEnvironmentVariable(
            "ConnectionStrings__DefaultConnection", _originalConnectionString);
        Environment.SetEnvironmentVariable(
            "HOLD_DURATION_SECONDS", _originalHoldDuration);

        if (_databaseName is not null)
        {
            NpgsqlConnection.ClearAllPools();
            await using var connection = new NpgsqlConnection(_adminConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"DROP DATABASE \"{_databaseName}\" WITH (FORCE)";
            await command.ExecuteNonQueryAsync();
        }
    }

    private sealed class TestApiFactory(string connectionString)
        : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DefaultConnection"] = connectionString,
                    ["HOLD_DURATION_SECONDS"] = "60"
                }));
        }
    }
}

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class AdmissionApiCollection : ICollectionFixture<AdmissionApiFixture>
{
    public const string Name = "Admission API";
}
