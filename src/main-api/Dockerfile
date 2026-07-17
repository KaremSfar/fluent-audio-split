FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime-base
WORKDIR /app
ARG YT_DLP_VERSION=2026.07.04
ARG YT_DLP_SHA256=495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd
ARG DENO_VERSION=2.9.3
ARG DENO_AMD64_SHA256=8101865641cbede56f08ad19c0a67a87df84bce127fee0d3e3e1f7467717ffa6
ARG DENO_ARM64_SHA256=753937db98a4b56cbbbd26e8f00eb4b789191a229afec93f74bcfa4e79bc2c8b
RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates \
	curl \
	ffmpeg \
	python3 \
	unzip \
	&& curl --fail --location --retry 3 \
		"https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" \
		--output /usr/local/bin/yt-dlp \
	&& echo "${YT_DLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum --check --status \
	&& chmod +x /usr/local/bin/yt-dlp \
	&& case "$(dpkg --print-architecture)" in \
		amd64) deno_asset="deno-x86_64-unknown-linux-gnu.zip"; deno_sha256="${DENO_AMD64_SHA256}" ;; \
		arm64) deno_asset="deno-aarch64-unknown-linux-gnu.zip"; deno_sha256="${DENO_ARM64_SHA256}" ;; \
		*) echo "Unsupported Deno architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
	   esac \
	&& curl --fail --location --retry 3 \
		"https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${deno_asset}" \
		--output /tmp/deno.zip \
	&& echo "${deno_sha256}  /tmp/deno.zip" | sha256sum --check --status \
	&& unzip -q /tmp/deno.zip -d /usr/local/bin \
	&& rm /tmp/deno.zip \
	&& rm -rf /var/lib/apt/lists/*

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY FluentAudioSplit.slnx ./
COPY FluentAudioSplit.Api/FluentAudioSplit.Api.csproj FluentAudioSplit.Api/
COPY FluentAudioSplit.Domain/FluentAudioSplit.Domain.csproj FluentAudioSplit.Domain/
COPY FluentAudioSplit.Infrastructure/FluentAudioSplit.Infrastructure.csproj FluentAudioSplit.Infrastructure/
RUN dotnet restore

COPY . .
RUN dotnet publish FluentAudioSplit.Api/FluentAudioSplit.Api.csproj -c Release -o /app/publish

FROM runtime-base AS runtime
COPY --from=build /app/publish .

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENV DENO_DIR=/tmp/deno
ENTRYPOINT ["dotnet", "FluentAudioSplit.Api.dll"]
