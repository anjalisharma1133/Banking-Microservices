# Dockerfile for Spring Boot Microservices
# Standard multi-stage build for Java applications

# Stage 1: Build the Java application
FROM maven:3.9.6-eclipse-temurin-17-alpine AS builder
WORKDIR /app
COPY pom.xml .
# Download dependencies using BuildKit cache mount
RUN --mount=type=cache,target=/root/.m2 mvn dependency:go-offline -B
COPY src ./src
# Build package using BuildKit cache mount
RUN --mount=type=cache,target=/root/.m2 mvn clean package -DskipTests -B

# Stage 2: Production environment (JRE)
FROM eclipse-temurin:17-jre-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=builder /app/target/banking-service-*.jar app.jar

# Expose the microservice port
EXPOSE 8080

# Start with optimized memory settings
# We use ENTRYPOINT with shell form to support environment variable expansion
ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS} -jar app.jar"]
