


FROM maven:3.9.6-eclipse-temurin-17-alpine AS builder
WORKDIR /app
COPY pom.xml .

RUN --mount=type=cache,target=/root/.m2 mvn dependency:go-offline -B
COPY src ./src

RUN --mount=type=cache,target=/root/.m2 mvn clean package -DskipTests -B


FROM eclipse-temurin:17-jre-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=builder /app/target/banking-service-*.jar app.jar


EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS} -jar app.jar"]
