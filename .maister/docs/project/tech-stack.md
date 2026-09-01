# Technology Stack

## Overview
This document describes the technology choices and rationale for **aj** — a plugin-based microkernel platform built on Spring Boot.

## Languages

### Java (25)
- **Usage**: 100% of codebase
- **Rationale**: Enterprise-grade language with strong ecosystem for plugin architectures, JVM stability, and Spring Boot compatibility
- **Key Features Used**: Records, sealed classes, pattern matching, virtual threads (available in Java 25)

## Frameworks

### Backend

#### Spring Boot (4.0.5)
- **Purpose**: Application framework and dependency injection
- **Modules Used**:
  - `spring-boot-starter-webmvc` — REST API support
  - `spring-boot-starter-data-jpa` — ORM abstraction layer
  - `spring-boot-starter-jooq` — Type-safe SQL query builder
  - `spring-boot-starter-liquibase` — Database schema versioning

### Testing

#### JUnit 5 (Jupiter)
- **Purpose**: Test framework
- **Scope**: Unit and integration tests

#### Spring Boot Test
- **Purpose**: Spring context testing support

#### TestContainers (PostgreSQL)
- **Purpose**: Containerized database for integration tests
- **Rationale**: Ensures tests run against real PostgreSQL, avoiding mock/production divergence

## Database

### PostgreSQL
- **Type**: Relational (RDBMS)
- **ORM/Client**: Spring Data JPA + JOOQ (dual)
- **Migration Tool**: Liquibase (changelog directory prepared, no migrations yet)
- **Rationale**: Robust relational database with strong support for multi-tenant architectures, JSONB for flexible plugin data, and row-level security

## Build Tools & Package Management

### Maven 3+ (with Maven Wrapper)
- **Build Plugin**: `spring-boot-maven-plugin`
- **Wrapper**: `mvnw` / `mvnw.cmd` for version-locked builds
- **Artifact**: `aj-0.0.1-SNAPSHOT`

## Infrastructure

### Containerization
- TestContainers used for test database isolation
- No production Docker configuration yet

### CI/CD
- Not yet configured

### Hosting
- Not yet determined

## Development Tools

### Linting & Formatting
- Using Spring Boot / IDE defaults (no explicit linter configured)

### Type Checking
- Java compiler (strongly typed language)

## Key Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| spring-boot-starter-webmvc | 4.0.5 | REST API |
| spring-boot-starter-data-jpa | 4.0.5 | ORM |
| spring-boot-starter-jooq | 4.0.5 | SQL query builder |
| spring-boot-starter-liquibase | 4.0.5 | Schema migrations |
| postgresql | runtime | Database driver |
| spring-boot-testcontainers | 4.0.5 | Test infrastructure |
| testcontainers-postgresql | — | Test database |

## Version Management
- Spring Boot BOM manages transitive dependency versions
- Maven Wrapper pins Maven version
- Java version specified in `pom.xml` (`<java.version>25</java.version>`)

## Architectural Decisions Pending
- **JPA vs JOOQ**: Both included — decision needed on which to standardize for domain model vs queries
- **Plugin framework**: Researched (PF4J, OSGi, JPMS) but not yet selected

---
*Last Updated*: 2026-03-28
*Auto-detected*: Language, framework, dependencies, database, build tools, testing infrastructure
