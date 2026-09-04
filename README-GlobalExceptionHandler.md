# GlobalExceptionHandler — Gestion centralisée des exceptions

## GlobalExceptionHandler.java

```java
package com.telecom.telecom.exception;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    // ────────────────────────────────────────────────────────────────────────
    // EXCEPTIONS MÉTIER
    // ────────────────────────────────────────────────────────────────────────

    /**
     * 404 — Incident introuvable
     * Levée par : getIncidentHistory(), qualifyIncident(), updateIncidentStatus()
     */
    @ExceptionHandler(IncidentNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleIncidentNotFound(
            IncidentNotFoundException ex,
            HttpServletRequest request) {

        log.warn("Incident introuvable : {}", ex.getMessage());

        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of(
                        HttpStatus.NOT_FOUND.value(),
                        "INCIDENT_NOT_FOUND",
                        ex.getMessage(),
                        request.getRequestURI()
                ));
    }

    /**
     * 404 — Utilisateur introuvable
     * Levée par : qualifyIncident(), updateIncidentStatus()
     */
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(
            UserNotFoundException ex,
            HttpServletRequest request) {

        log.warn("Utilisateur introuvable : {}", ex.getMessage());

        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of(
                        HttpStatus.NOT_FOUND.value(),
                        "USER_NOT_FOUND",
                        ex.getMessage(),
                        request.getRequestURI()
                ));
    }

    /**
     * 409 — Statut terminal (RESOLVED/CLOSED) ne peut pas être qualifié
     * Levée par : qualifyIncident()
     */
    @ExceptionHandler(InvalidIncidentStateException.class)
    public ResponseEntity<ErrorResponse> handleInvalidState(
            InvalidIncidentStateException ex,
            HttpServletRequest request) {

        log.warn("Statut invalide pour qualification : {}", ex.getMessage());

        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of(
                        HttpStatus.CONFLICT.value(),
                        "INVALID_INCIDENT_STATE",
                        ex.getMessage(),
                        request.getRequestURI()
                ));
    }

    /**
     * 409 — Transition de statut non autorisée
     * Levée par : updateIncidentStatus() via WorkflowValidator
     * Ex : OPEN → RESOLVED interdit
     */
    @ExceptionHandler(InvalidStatusTransitionException.class)
    public ResponseEntity<ErrorResponse> handleInvalidTransition(
            InvalidStatusTransitionException ex,
            HttpServletRequest request) {

        log.warn("Transition workflow invalide : {}", ex.getMessage());

        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of(
                        HttpStatus.CONFLICT.value(),
                        "INVALID_STATUS_TRANSITION",
                        ex.getMessage(),
                        request.getRequestURI()
                ));
    }

    // ────────────────────────────────────────────────────────────────────────
    // EXCEPTIONS DE VALIDATION
    // ────────────────────────────────────────────────────────────────────────

    /**
     * 400 — Champs @NotNull, @NotBlank, @Valid échoués
     * Ex : incidentType null, priority null, userId null
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ValidationErrorResponse> handleValidation(
            MethodArgumentNotValidException ex,
            HttpServletRequest request) {

        Map<String, String> fieldErrors = new HashMap<>();
        ex.getBindingResult()
          .getFieldErrors()
          .forEach(e -> fieldErrors.put(e.getField(), e.getDefaultMessage()));

        log.warn("Erreur de validation : {}", fieldErrors);

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ValidationErrorResponse.of(
                        HttpStatus.BAD_REQUEST.value(),
                        "VALIDATION_ERROR",
                        "Un ou plusieurs champs sont invalides",
                        request.getRequestURI(),
                        fieldErrors
                ));
    }

    /**
     * 400 — JSON illisible ou valeur enum invalide
     * Ex : "priority": "VERY_HIGH" (n'existe pas dans l'enum)
     *      ou body JSON mal formé
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleNotReadable(
            HttpMessageNotReadableException ex,
            HttpServletRequest request) {

        log.warn("Message HTTP illisible : {}", ex.getMessage());

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of(
                        HttpStatus.BAD_REQUEST.value(),
                        "INVALID_REQUEST_BODY",
                        "Corps de la requête invalide ou valeur enum incorrecte",
                        request.getRequestURI()
                ));
    }

    /**
     * 405 — Méthode HTTP non supportée
     * Ex : GET sur un endpoint PATCH
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethodNotSupported(
            HttpRequestMethodNotSupportedException ex,
            HttpServletRequest request) {

        log.warn("Méthode HTTP non supportée : {}", ex.getMessage());

        return ResponseEntity
                .status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(ErrorResponse.of(
                        HttpStatus.METHOD_NOT_ALLOWED.value(),
                        "METHOD_NOT_ALLOWED",
                        "Méthode " + ex.getMethod() + " non supportée sur cette URL",
                        request.getRequestURI()
                ));
    }

    /**
     * 500 — Toute exception non gérée
     * Filet de sécurité global
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneric(
            Exception ex,
            HttpServletRequest request) {

        log.error("Erreur inattendue : ", ex);

        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse.of(
                        HttpStatus.INTERNAL_SERVER_ERROR.value(),
                        "INTERNAL_SERVER_ERROR",
                        "Une erreur interne est survenue",
                        request.getRequestURI()
                ));
    }
}
```

---

## ErrorResponse.java — DTO de réponse d'erreur

```java
package com.telecom.telecom.exception;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ErrorResponse {

    private int       status;
    private String    code;
    private String    message;
    private String    path;

    @JsonFormat(pattern = "dd/MM/yyyy HH:mm:ss")
    private LocalDateTime timestamp;

    public static ErrorResponse of(int status, String code,
                                   String message, String path) {
        return ErrorResponse.builder()
                .status(status)
                .code(code)
                .message(message)
                .path(path)
                .timestamp(LocalDateTime.now())
                .build();
    }
}
```

---

## ValidationErrorResponse.java — DTO pour les erreurs de validation

```java
package com.telecom.telecom.exception;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ValidationErrorResponse {

    private int                 status;
    private String              code;
    private String              message;
    private String              path;
    private Map<String, String> fieldErrors;

    @JsonFormat(pattern = "dd/MM/yyyy HH:mm:ss")
    private LocalDateTime timestamp;

    public static ValidationErrorResponse of(int status, String code,
                                              String message, String path,
                                              Map<String, String> fieldErrors) {
        return ValidationErrorResponse.builder()
                .status(status)
                .code(code)
                .message(message)
                .path(path)
                .fieldErrors(fieldErrors)
                .timestamp(LocalDateTime.now())
                .build();
    }
}
```

---

## Tableau récapitulatif

| Exception | Code HTTP | Code erreur | Déclencheur |
|-----------|-----------|-------------|-------------|
| `IncidentNotFoundException` | 404 | `INCIDENT_NOT_FOUND` | id incident inexistant |
| `UserNotFoundException` | 404 | `USER_NOT_FOUND` | userId inexistant |
| `InvalidIncidentStateException` | 409 | `INVALID_INCIDENT_STATE` | qualifier un incident CLOSED |
| `InvalidStatusTransitionException` | 409 | `INVALID_STATUS_TRANSITION` | OPEN → RESOLVED par ex. |
| `MethodArgumentNotValidException` | 400 | `VALIDATION_ERROR` | champ @NotNull null |
| `HttpMessageNotReadableException` | 400 | `INVALID_REQUEST_BODY` | enum invalide ou JSON cassé |
| `HttpRequestMethodNotSupportedException` | 405 | `METHOD_NOT_ALLOWED` | mauvaise méthode HTTP |
| `Exception` | 500 | `INTERNAL_SERVER_ERROR` | tout le reste |

---

## Exemples de réponses Postman

### 404 — Incident introuvable
```json
{
  "status": 404,
  "code": "INCIDENT_NOT_FOUND",
  "message": "Incident introuvable avec l'id : 99",
  "path": "/api/incidents/99/qualify",
  "timestamp": "04/09/2026 10:15:30"
}
```

### 409 — Transition invalide
```json
{
  "status": 409,
  "code": "INVALID_STATUS_TRANSITION",
  "message": "Transition invalide : OPEN → RESOLVED n'est pas autorisée",
  "path": "/api/incidents/1/status",
  "timestamp": "04/09/2026 10:16:00"
}
```

### 400 — Champ manquant
```json
{
  "status": 400,
  "code": "VALIDATION_ERROR",
  "message": "Un ou plusieurs champs sont invalides",
  "path": "/api/incidents/1/qualify",
  "timestamp": "04/09/2026 10:17:00",
  "fieldErrors": {
    "incidentType": "Le type d'incident est obligatoire",
    "priority": "La priorité est obligatoire"
  }
}
```

### 400 — Enum invalide
```json
{
  "status": 400,
  "code": "INVALID_REQUEST_BODY",
  "message": "Corps de la requête invalide ou valeur enum incorrecte",
  "path": "/api/incidents/1/qualify",
  "timestamp": "04/09/2026 10:18:00"
}
```

### 500 — Erreur interne
```json
{
  "status": 500,
  "code": "INTERNAL_SERVER_ERROR",
  "message": "Une erreur interne est survenue",
  "path": "/api/incidents/1/status",
  "timestamp": "04/09/2026 10:19:00"
}
```
