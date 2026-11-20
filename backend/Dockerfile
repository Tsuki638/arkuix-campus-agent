FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml ./
COPY src ./src
RUN mvn -B -ntp package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/campus-agent-backend.jar ./app.jar
RUN mkdir /app/data && chown 10001:10001 /app/data
ENV SERVER_ADDRESS=0.0.0.0 APP_DATA_DIRECTORY=/app/data
EXPOSE 8080
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
