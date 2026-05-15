using System.Text;
using FluentAudioSplit.Api.Services;
using FluentAudioSplit.Auth.Services;
using FluentAudioSplit.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using FluentAudioSplit.Domain.Entities;

namespace FluentAudioSplit.Api;

public class Startup
{
    public IConfiguration Configuration { get; }
    public IWebHostEnvironment Environment { get; }

    public Startup(IConfiguration configuration, IWebHostEnvironment environment)
    {
        Configuration = configuration;
        Environment = environment;
    }

    public void ConfigureServices(IServiceCollection services)
    {
        services.AddControllers();
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen();

        // Database — SQLite, ensure the data directory exists (Docker volume mount)
        var connectionString = Configuration.GetConnectionString("DefaultConnection")
            ?? "Data Source=fluent_audio_split.db";
            
        var dataSourcePath = connectionString
            .Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Trim())
            .FirstOrDefault(p => p.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase))
            ?.Substring("Data Source=".Length);

        if (!string.IsNullOrEmpty(dataSourcePath))
        {
            var dir = Path.GetDirectoryName(dataSourcePath);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);
        }

        services.AddDbContextFactory<ApplicationDbContext>(options =>
            options.UseSqlite(connectionString));

        services.AddHostedService<MigrationsService<ApplicationDbContext>>();

        // Identity
        services.AddIdentity<ApplicationUser, IdentityRole>(options =>
        {
            options.Password.RequireDigit = true;
            options.Password.RequiredLength = 8;
            options.Password.RequireNonAlphanumeric = false;
            options.User.RequireUniqueEmail = true;
        })
        .AddEntityFrameworkStores<ApplicationDbContext>()
        .AddDefaultTokenProviders();

        // JWT Authentication
        var jwtSettings = Configuration.GetSection("JwtSettings");
        var secret = jwtSettings["Secret"] ?? "default-dev-secret-change-in-production-please";
        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(options =>
        {
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = jwtSettings["Issuer"],
                ValidAudience = jwtSettings["Audience"],
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret))
            };
        });

        services.AddAuthorization();

        // CORS — allow the React dev server
        services.AddCors(options =>
        {
            options.AddPolicy("FrontendDev", policy =>
                policy.SetIsOriginAllowed(p => true)
                      .AllowAnyHeader()
                      .AllowAnyMethod());
        });

        // Auth services
        services.AddScoped<ITokenService, TokenService>();
        services.AddScoped<IRabbitMqPublisher, RabbitMqPublisher>();

        // OpenTelemetry
        services.AddOpenTelemetry()
            .WithTracing(tracing =>
            {
                tracing
                    .SetResourceBuilder(ResourceBuilder.CreateDefault()
                        .AddService("fluent-audio-split-api"))
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddConsoleExporter(); // Switch to OTLP when collector is available
                    // Uncomment when OTel collector is ready:
                    // .AddOtlpExporter(o => o.Endpoint = new Uri(Configuration["OpenTelemetry:Endpoint"] ?? "http://localhost:4317"));
            })
            .WithMetrics(metrics =>
            {
                metrics
                    .SetResourceBuilder(ResourceBuilder.CreateDefault()
                        .AddService("fluent-audio-split-api"))
                    .AddAspNetCoreInstrumentation()
                    .AddConsoleExporter();
            });
    }

    public void Configure(WebApplication app, IWebHostEnvironment env)
    {
        if (env.IsDevelopment())
        {
            app.UseSwagger();
            app.UseSwaggerUI();
        }

        app.UseRouting();
        app.UseCors("FrontendDev");
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
    }
}
