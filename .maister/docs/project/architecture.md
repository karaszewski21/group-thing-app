# System Architecture

## Overview
**aj** is a plugin-based microkernel platform built on Spring Boot 4.0.5 with Java 25. The system is currently in pre-alpha scaffolding phase — the baseline application is set up with database infrastructure, but no business logic or plugin framework is implemented yet.

## Architecture Pattern
**Pattern**: Microkernel (Plugin-Based) — Planned

The target architecture separates a minimal core (the "microkernel") from extensible functionality delivered through plugins. The core handles lifecycle management, plugin loading, and shared services (database, authentication, API routing), while plugins provide domain-specific features.

**Current state**: Monolithic Spring Boot baseline with research completed on plugin frameworks (PF4J, OSGi, JPMS).

## System Structure

### Application Core
- **Location**: `src/main/java/pl/devstyle/aj/`
- **Purpose**: Spring Boot application bootstrap
- **Key Files**: `AjApplication.java` (entry point)

### Configuration
- **Location**: `src/main/resources/`
- **Purpose**: Application configuration and static resources
- **Key Files**: `application.properties`

### Database Layer
- **Location**: `src/main/resources/db/changelog/`
- **Purpose**: Liquibase database migrations (empty — schema not yet defined)
- **Technology**: PostgreSQL with JPA + JOOQ

### Test Infrastructure
- **Location**: `src/test/java/pl/devstyle/aj/`
- **Purpose**: Integration test support with containerized PostgreSQL
- **Key Files**:
  - `AjApplicationTests.java` — Context loading verification
  - `TestAjApplication.java` — Test runner configuration
  - `TestcontainersConfiguration.java` — PostgreSQL container setup

## Data Flow
Not yet implemented. Target data flow for the plugin architecture:

```
Client Request → API Gateway → Core Router → Plugin Handler → Service Layer → Database
                                    ↓
                              Plugin Registry
```

## External Integrations
- **PostgreSQL**: Primary datastore (configured for runtime + test)
- No external API integrations yet

## Database Schema
- **Migration tool**: Liquibase
- **Changelog location**: `src/main/resources/db/changelog/`
- **Status**: Empty — schema design pending (multi-tenant strategy to be determined)

## Configuration
- **Main config**: `src/main/resources/application.properties`
- **Pattern**: Spring Boot properties-based configuration
- **Profiles**: Not yet configured (ready for `application-{profile}.properties`)

## Package Structure
```
pl.devstyle.aj
├── AjApplication.java          (bootstrap)
└── [planned]
    ├── core/                   (microkernel core)
    ├── plugin/                 (plugin framework integration)
    ├── api/                    (REST controllers)
    ├── domain/                 (entities, repositories)
    └── config/                 (Spring configuration)
```

## Deployment Architecture
- Not yet configured
- TestContainers used for test environments

---
*Based on codebase analysis performed 2026-03-28*
