FROM eclipse-temurin:21-jdk as build
WORKDIR /app
COPY . .
RUN ./mvnw package -DskipTests || mvn package -DskipTests || true

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar /app/app.jar
RUN useradd -m appuser
USER appuser
ENV PORT=8080
EXPOSE 8080
CMD ["java","-jar","/app/app.jar"]
