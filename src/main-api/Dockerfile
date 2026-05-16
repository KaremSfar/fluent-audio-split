FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY FluentAudioSplit.slnx ./
COPY FluentAudioSplit.Api/FluentAudioSplit.Api.csproj FluentAudioSplit.Api/
COPY FluentAudioSplit.Domain/FluentAudioSplit.Domain.csproj FluentAudioSplit.Domain/
COPY FluentAudioSplit.Infrastructure/FluentAudioSplit.Infrastructure.csproj FluentAudioSplit.Infrastructure/
RUN dotnet restore

COPY . .
RUN dotnet publish FluentAudioSplit.Api/FluentAudioSplit.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "FluentAudioSplit.Api.dll"]
