# 📋 README — Ticket : Affectation / Désaffectation Technicien ↔ Incident

## 🎯 User Story

> **En tant que** Responsable,  
> **Je veux** affecter ou désaffecter un technicien disponible  
> **Afin d'assurer** le traitement de l'incident.

**Epic :** EPIC-4 Affectation  
**Estimation :** 1 jour

---

# 1. 📐 Règles métier

## Affectation

| # | Règle | Comportement si violée |
|---|---|---|
| 1 | Seuls les incidents au statut **OPEN** peuvent être affectés | `409 Conflict` |
| 2 | Un incident ne peut avoir qu'**une seule affectation active** à la fois | `409 Conflict` |
| 3 | Un technicien est **non disponible** s'il a déjà un incident **IN_PROGRESS** | `409 Conflict` |
| 4 | Un technicien peut gérer **plusieurs incidents OPEN** simultanément | Autorisé |
| 5 | L'affectation est historisée dans `incident_history` | — |
| 6 | Seul un utilisateur ayant le rôle `RESPONSABLE` peut affecter un technicien | `403 Forbidden` |

## Désaffectation

| # | Règle | Comportement si violée |
|---|---|---|
| 7 | On ne peut désaffecter que si l'incident est **OPEN** | `409 Conflict` |
| 8 | L'incident doit avoir une **affectation active** | `404 Not Found` |
| 9 | La désaffectation est **soft** : `active = false` | — |
| 10 | L'incident est détaché de l'affectation : `incidentAssignment = null` | — |
| 11 | La désaffectation est historisée dans `incident_history` | — |
| 12 | Seul un utilisateur ayant le rôle `RESPONSABLE` peut désaffecter | `403 Forbidden` |

---

# 2. 🏗️ Conception conservée — `OneToOne`

La conception existante est conservée.

La clé étrangère reste portée par la table `incidents` :

```text
incidents
──────────────────────────────
id
title
incident_status
incident_assignment_id  ─────────────┐
                                     │
                                     ▼
incident_assignments
──────────────────────────────
id
assignment_date
comment
active
technician_id
```

Relation Java :

```text
Incident 1 ───────── 1 IncidentAssignment
                           │
                           │ N
                           ▼
                      Technician
```

Aucune modification du schéma de cette relation n'est demandée dans ce ticket.

---

# 3. 🗂️ Entité `IncidentAssignment`

```java
@Entity
@Table(name = "incident_assignments")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IncidentAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(name = "assignment_date")
    private LocalDateTime assignmentDate;

    private String comment;

    /**
     * true  = affectation active
     * false = affectation désactivée
     */
    private Boolean active;

    /**
     * Relation inverse.
     * La FK est portée par Incident.incident_assignment_id.
     */
    @OneToOne(mappedBy = "incidentAssignment")
    private Incident incident;

    /**
     * Un technicien peut avoir plusieurs affectations.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "technician_id", nullable = false)
    private Technician technician;
}
```

---

# 4. 🗂️ Relation côté `Incident`

```java
@OneToOne
@JoinColumn(name = "incident_assignment_id")
private IncidentAssignment incidentAssignment;
```

Cette relation reste inchangée.

---

# 5. 📦 DTO

## `AssignIncidentRequest.java`

Le frontend envoie uniquement le technicien à affecter et éventuellement un commentaire.

Le `responsableId` **ne doit pas être envoyé dans le JSON**.

```java
@Data
public class AssignIncidentRequest {

    @NotNull(message = "Le technicien est obligatoire")
    private Long technicianId;

    @Size(max = 1000, message = "Le commentaire ne doit pas dépasser 1000 caractères")
    private String comment;
}
```

### Exemple JSON

```json
{
  "technicianId": 5,
  "comment": "Affectation traitement urgent messagerie"
}
```

---

## `UnassignIncidentRequest.java`

```java
@Data
public class UnassignIncidentRequest {

    @Size(max = 1000, message = "Le commentaire ne doit pas dépasser 1000 caractères")
    private String comment;
}
```

### Exemple JSON

```json
{
  "comment": "Technicien redirigé vers un incident critique"
}
```

---

# 6. 📤 DTO de réponse

## `AssignmentResponse.java`

```java
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssignmentResponse {

    private Long assignmentId;

    private Long technicianId;

    private String technicianUsername;

    private LocalDateTime assignmentDate;

    private String comment;

    private Boolean active;
}
```

---

# 7. 🗄️ Repository — `IncidentAssignmentRepository`

```java
public interface IncidentAssignmentRepository
        extends JpaRepository<IncidentAssignment, Long> {

    /**
     * Protection contre la double affectation.
     */
    boolean existsByIncidentIdAndActiveTrue(Long incidentId);

    /**
     * Retourne l'affectation active d'un incident.
     */
    Optional<IncidentAssignment>
        findByIncidentIdAndActiveTrue(Long incidentId);

    /**
     * Vérifie si un technicien possède déjà
     * un incident IN_PROGRESS.
     */
    boolean existsByTechnicianIdAndIncident_IncidentStatus(
        Long technicianId,
        IncidentStatus status
    );
}
```

---

# 8. 🗄️ Repository — `IncidentRepository`

```java
public interface IncidentRepository
        extends JpaRepository<Incident, Long> {
}
```

---

# 9. 🗄️ Repository — `TechnicianRepository`

```java
public interface TechnicianRepository
        extends JpaRepository<Technician, Long> {
}
```

---

# 10. 🗄️ Repository — `UserRepository`

Le responsable connecté est récupéré depuis Spring Security, puis chargé depuis la base.

```java
public interface UserRepository
        extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);
}
```

> Si ton JWT utilise l'email comme `subject`, remplacer `findByUsername(...)` par `findByEmail(...)`.

---

# 11. 🔐 Récupération du responsable connecté

Le `responsableId` ne vient jamais du frontend.

Le responsable qui effectue l'action est récupéré directement depuis le `SecurityContext`.

## `CurrentUserService.java`

```java
@Service
@RequiredArgsConstructor
public class CurrentUserService {

    private final UserRepository userRepository;

    public User getCurrentUser() {

        Authentication authentication =
            SecurityContextHolder
                .getContext()
                .getAuthentication();

        if (authentication == null
                || !authentication.isAuthenticated()
                || authentication.getName() == null) {

            throw new AuthenticationCredentialsNotFoundException(
                "Utilisateur non authentifié"
            );
        }

        String username = authentication.getName();

        return userRepository
            .findByUsername(username)
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Utilisateur connecté introuvable : " + username
                )
            );
    }
}
```

Ainsi :

```text
JWT
 │
 ▼
Spring Security
 │
 ▼
SecurityContext
 │
 ▼
authentication.getName()
 │
 ▼
UserRepository
 │
 ▼
Responsable connecté
```

---

# 12. ⚠️ Exceptions métier

Les services ne construisent pas directement des réponses HTTP.

Ils lèvent des exceptions métier qui sont traitées par un `GlobalExceptionHandler`.

---

## `ResourceNotFoundException.java`

```java
public class ResourceNotFoundException
        extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
```

---

## `BusinessConflictException.java`

```java
public class BusinessConflictException
        extends RuntimeException {

    public BusinessConflictException(String message) {
        super(message);
    }
}
```

---

## `BadRequestException.java`

```java
public class BadRequestException
        extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
```

---

# 13. 🌐 Format d'erreur API

## `ApiError.java`

```java
@Getter
@Builder
public class ApiError {

    private LocalDateTime timestamp;

    private int status;

    private String error;

    private String message;

    private String path;
}
```

Exemple :

```json
{
  "timestamp": "2026-09-05T14:00:00",
  "status": 409,
  "error": "Conflict",
  "message": "L'incident 2 est déjà affecté à un technicien.",
  "path": "/api/incidents/2/assign"
}
```

---

# 14. 🛡️ Global Exception Handler

## `GlobalExceptionHandler.java`

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(
            ResourceNotFoundException ex,
            HttpServletRequest request) {

        return buildError(
            HttpStatus.NOT_FOUND,
            ex.getMessage(),
            request.getRequestURI()
        );
    }

    @ExceptionHandler(BusinessConflictException.class)
    public ResponseEntity<ApiError> handleConflict(
            BusinessConflictException ex,
            HttpServletRequest request) {

        return buildError(
            HttpStatus.CONFLICT,
            ex.getMessage(),
            request.getRequestURI()
        );
    }

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<ApiError> handleBadRequest(
            BadRequestException ex,
            HttpServletRequest request) {

        return buildError(
            HttpStatus.BAD_REQUEST,
            ex.getMessage(),
            request.getRequestURI()
        );
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(
            MethodArgumentNotValidException ex,
            HttpServletRequest request) {

        String message = ex
            .getBindingResult()
            .getFieldErrors()
            .stream()
            .findFirst()
            .map(error ->
                error.getField()
                    + " : "
                    + error.getDefaultMessage()
            )
            .orElse("Requête invalide");

        return buildError(
            HttpStatus.BAD_REQUEST,
            message,
            request.getRequestURI()
        );
    }

    @ExceptionHandler(AuthenticationCredentialsNotFoundException.class)
    public ResponseEntity<ApiError> handleAuthentication(
            AuthenticationCredentialsNotFoundException ex,
            HttpServletRequest request) {

        return buildError(
            HttpStatus.UNAUTHORIZED,
            ex.getMessage(),
            request.getRequestURI()
        );
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpectedException(
            Exception ex,
            HttpServletRequest request) {

        return buildError(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "Une erreur interne est survenue",
            request.getRequestURI()
        );
    }

    private ResponseEntity<ApiError> buildError(
            HttpStatus status,
            String message,
            String path) {

        ApiError apiError = ApiError.builder()
            .timestamp(LocalDateTime.now())
            .status(status.value())
            .error(status.getReasonPhrase())
            .message(message)
            .path(path)
            .build();

        return ResponseEntity
            .status(status)
            .body(apiError);
    }
}
```

---

# 15. ⚙️ Service — `IncidentAssignmentService`

```java
@Service
@RequiredArgsConstructor
@Transactional
public class IncidentAssignmentService {

    private final IncidentRepository incidentRepository;

    private final IncidentAssignmentRepository assignmentRepository;

    private final TechnicianRepository technicianRepository;

    private final IncidentHistoryRepository historyRepository;

    private final CurrentUserService currentUserService;


    // ============================================================
    // AFFECTATION
    // ============================================================

    public void assignTechnician(
            Long incidentId,
            AssignIncidentRequest request) {

        // 1. Récupérer l'incident
        Incident incident = incidentRepository
            .findById(incidentId)
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Incident introuvable : id=" + incidentId
                )
            );


        // 2. Seuls les incidents OPEN peuvent être affectés
        if (incident.getIncidentStatus()
                != IncidentStatus.OPEN) {

            throw new BusinessConflictException(
                "Seuls les incidents OPEN peuvent être affectés. "
                    + "Statut actuel : "
                    + incident.getIncidentStatus()
            );
        }


        // 3. Protection double affectation
        if (assignmentRepository
                .existsByIncidentIdAndActiveTrue(incidentId)) {

            throw new BusinessConflictException(
                "L'incident "
                    + incidentId
                    + " est déjà affecté à un technicien. "
                    + "Veuillez d'abord le désaffecter "
                    + "avant une nouvelle affectation."
            );
        }


        // 4. Récupérer le technicien
        Technician technician = technicianRepository
            .findById(request.getTechnicianId())
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Technicien introuvable : id="
                        + request.getTechnicianId()
                )
            );


        // 5. Vérifier la disponibilité du technicien
        boolean occupied = assignmentRepository
            .existsByTechnicianIdAndIncident_IncidentStatus(
                technician.getId(),
                IncidentStatus.IN_PROGRESS
            );

        if (occupied) {

            throw new BusinessConflictException(
                "Le technicien '"
                    + technician.getUsername()
                    + "' est non disponible : "
                    + "il possède déjà un incident "
                    + "IN_PROGRESS."
            );
        }


        // 6. Récupérer automatiquement le responsable connecté
        User responsable =
            currentUserService.getCurrentUser();


        // 7. Créer l'affectation
        IncidentAssignment assignment =
            new IncidentAssignment();

        assignment.setAssignmentDate(
            LocalDateTime.now()
        );

        assignment.setComment(
            request.getComment()
        );

        assignment.setActive(true);

        assignment.setTechnician(
            technician
        );


        // 8. Sauvegarder l'affectation
        assignmentRepository.save(
            assignment
        );


        // 9. Lier l'affectation à l'incident
        incident.setIncidentAssignment(
            assignment
        );

        incidentRepository.save(
            incident
        );


        // 10. Historiser l'action
        saveHistory(
            incident,
            responsable,
            "Affectation — Technicien : "
                + technician.getUsername()
                + buildComment(
                    " | Note : ",
                    request.getComment()
                )
        );
    }


    // ============================================================
    // DÉSAFFECTATION
    // ============================================================

    public void unassignTechnician(
            Long incidentId,
            UnassignIncidentRequest request) {

        // 1. Récupérer l'incident
        Incident incident = incidentRepository
            .findById(incidentId)
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Incident introuvable : id=" + incidentId
                )
            );


        // 2. La désaffectation n'est possible que pour OPEN
        if (incident.getIncidentStatus()
                != IncidentStatus.OPEN) {

            throw new BusinessConflictException(
                "Impossible de désaffecter : "
                    + "l'incident est déjà en cours "
                    + "ou clôturé. Statut actuel : "
                    + incident.getIncidentStatus()
            );
        }


        // 3. Récupérer l'affectation active
        IncidentAssignment assignment =
            assignmentRepository
                .findByIncidentIdAndActiveTrue(
                    incidentId
                )
                .orElseThrow(() ->
                    new ResourceNotFoundException(
                        "Aucune affectation active "
                            + "trouvée pour l'incident "
                            + incidentId
                    )
                );


        // 4. Responsable connecté depuis Spring Security
        User responsable =
            currentUserService.getCurrentUser();


        String technicianName =
            assignment
                .getTechnician()
                .getUsername();


        // 5. Soft delete
        assignment.setActive(false);

        assignmentRepository.save(
            assignment
        );


        // 6. Détacher l'affectation de l'incident
        incident.setIncidentAssignment(
            null
        );

        incidentRepository.save(
            incident
        );


        // 7. Historiser
        saveHistory(
            incident,
            responsable,
            "Désaffectation — Technicien : "
                + technicianName
                + " retiré de l'incident"
                + buildComment(
                    " | Motif : ",
                    request.getComment()
                )
        );
    }


    // ============================================================
    // CONSULTATION DE L'AFFECTATION ACTIVE
    // ============================================================

    @Transactional(readOnly = true)
    public Optional<AssignmentResponse> getAssignment(
            Long incidentId) {

        if (!incidentRepository.existsById(incidentId)) {

            throw new ResourceNotFoundException(
                "Incident introuvable : id="
                    + incidentId
            );
        }

        return assignmentRepository
            .findByIncidentIdAndActiveTrue(
                incidentId
            )
            .map(assignment ->
                AssignmentResponse.builder()
                    .assignmentId(
                        assignment.getId()
                    )
                    .technicianId(
                        assignment
                            .getTechnician()
                            .getId()
                    )
                    .technicianUsername(
                        assignment
                            .getTechnician()
                            .getUsername()
                    )
                    .assignmentDate(
                        assignment
                            .getAssignmentDate()
                    )
                    .comment(
                        assignment.getComment()
                    )
                    .active(
                        assignment.getActive()
                    )
                    .build()
            );
    }


    // ============================================================
    // HISTORIQUE
    // ============================================================

    private void saveHistory(
            Incident incident,
            User modifiedBy,
            String comment) {

        IncidentHistory history =
            new IncidentHistory();

        history.setIncident(
            incident
        );

        /**
         * L'affectation/désaffectation ne change pas
         * directement le statut de l'incident.
         */
        history.setOldStatus(null);

        history.setNewStatus(null);

        history.setComment(
            comment
        );

        history.setModifiedBy(
            modifiedBy
        );

        history.setModificationDate(
            LocalDateTime.now()
        );

        historyRepository.save(
            history
        );
    }


    // ============================================================
    // HELPER COMMENTAIRE
    // ============================================================

    private String buildComment(
            String prefix,
            String comment) {

        if (comment == null
                || comment.isBlank()) {

            return "";
        }

        return prefix + comment;
    }
}
```

---

# 16. 🎮 Controller

## `IncidentAssignmentController.java`

```java
@RestController
@RequestMapping("/api/incidents")
@RequiredArgsConstructor
public class IncidentAssignmentController {

    private final IncidentAssignmentService
        assignmentService;


    /**
     * POST /api/incidents/{id}/assign
     *
     * Affecter un technicien à un incident.
     */
    @PreAuthorize("hasRole('RESPONSABLE')")
    @PostMapping("/{id}/assign")
    public ResponseEntity<Void> assign(
            @PathVariable Long id,
            @RequestBody
            @Valid AssignIncidentRequest request) {

        assignmentService.assignTechnician(
            id,
            request
        );

        return ResponseEntity
            .ok()
            .build();
    }


    /**
     * PATCH /api/incidents/{id}/unassign
     *
     * Désaffecter le technicien actif.
     */
    @PreAuthorize("hasRole('RESPONSABLE')")
    @PatchMapping("/{id}/unassign")
    public ResponseEntity<Void> unassign(
            @PathVariable Long id,
            @RequestBody
            @Valid UnassignIncidentRequest request) {

        assignmentService.unassignTechnician(
            id,
            request
        );

        return ResponseEntity
            .ok()
            .build();
    }


    /**
     * GET /api/incidents/{id}/assignment
     *
     * Consulter l'affectation active.
     */
    @PreAuthorize("isAuthenticated()")
    @GetMapping("/{id}/assignment")
    public ResponseEntity<AssignmentResponse>
            getAssignment(
                @PathVariable Long id) {

        return assignmentService
            .getAssignment(id)
            .map(ResponseEntity::ok)
            .orElseGet(() ->
                ResponseEntity
                    .notFound()
                    .build()
            );
    }
}
```

---

# 17. 🔁 Endpoints

| Méthode | URL | Autorisation | Body |
|---|---|---|---|
| `POST` | `/api/incidents/{id}/assign` | `RESPONSABLE` | `technicianId`, `comment` |
| `PATCH` | `/api/incidents/{id}/unassign` | `RESPONSABLE` | `comment` |
| `GET` | `/api/incidents/{id}/assignment` | Utilisateur authentifié | — |

---

# 18. 🧪 Scénarios de test

## ✅ CAS 1 — Affectation réussie

```http
POST http://localhost:8080/api/incidents/2/assign
Authorization: Bearer <TOKEN_RESPONSABLE>
Content-Type: application/json
```

```json
{
  "technicianId": 5,
  "comment": "Affectation traitement urgent messagerie"
}
```

Résultat attendu :

```text
200 OK
```

En base :

```text
incident_assignments.active = true
incidents.incident_assignment_id = id de la nouvelle affectation
```

L'historique contient le responsable récupéré automatiquement depuis Spring Security.

---

## ✅ CAS 2 — Même technicien sur plusieurs incidents OPEN

```http
POST /api/incidents/3/assign
```

```json
{
  "technicianId": 5,
  "comment": "Deuxième incident OPEN"
}
```

Si le technicien n'a aucun incident `IN_PROGRESS` :

```text
200 OK
```

---

## ❌ CAS 3 — Double affectation

L'incident `2` est déjà affecté.

```http
POST /api/incidents/2/assign
```

```json
{
  "technicianId": 6
}
```

Résultat :

```text
409 Conflict
```

---

## ❌ CAS 4 — Incident non OPEN

```http
POST /api/incidents/1/assign
```

```json
{
  "technicianId": 5
}
```

Si l'incident est `IN_PROGRESS` :

```text
409 Conflict
```

---

## ❌ CAS 5 — Technicien occupé

Le technicien `4` possède déjà un incident `IN_PROGRESS`.

```http
POST /api/incidents/2/assign
```

```json
{
  "technicianId": 4
}
```

Résultat :

```text
409 Conflict
```

---

## ❌ CAS 6 — Technicien inexistant

```http
POST /api/incidents/2/assign
```

```json
{
  "technicianId": 99999
}
```

Résultat :

```text
404 Not Found
```

---

## ✅ CAS 7 — Désaffectation réussie

```http
PATCH /api/incidents/2/unassign
Authorization: Bearer <TOKEN_RESPONSABLE>
Content-Type: application/json
```

```json
{
  "comment": "Technicien redirigé vers un incident critique"
}
```

Résultat :

```text
200 OK
```

En base :

```text
incident_assignments.active = false
incidents.incident_assignment_id = null
```

---

## ✅ CAS 8 — Réaffectation après désaffectation

Après la désaffectation :

```http
POST /api/incidents/2/assign
```

```json
{
  "technicianId": 6,
  "comment": "Réaffectation"
}
```

Résultat attendu :

```text
200 OK
```

---

## ❌ CAS 9 — Désaffecter un incident IN_PROGRESS

```http
PATCH /api/incidents/1/unassign
```

```json
{}
```

Résultat :

```text
409 Conflict
```

---

## ❌ CAS 10 — Désaffecter sans affectation active

```http
PATCH /api/incidents/5/unassign
```

```json
{}
```

Résultat :

```text
404 Not Found
```

---

## ❌ CAS 11 — Utilisateur non RESPONSABLE

Un utilisateur ayant le rôle `TECHNICIEN` appelle :

```http
POST /api/incidents/2/assign
```

Résultat :

```text
403 Forbidden
```

Même comportement pour :

```http
PATCH /api/incidents/2/unassign
```

---

# 19. 🔁 Workflow complet

```text
[0] Incident OPEN
      │
      ▼
[1] POST /api/incidents/{id}/assign
      │
      ▼
    Affectation active
      │
      ├───────────────────────────────────┐
      │                                   │
      │ changement technicien             │ démarrage traitement
      │                                   │
      ▼                                   ▼
PATCH /unassign                    Status IN_PROGRESS
      │                                   │
      ▼                                   │
active = false                            │
incident_assignment_id = null            │
      │                                   │
      ▼                                   │
Réaffectation possible                    │
                                          ▼
                                      RESOLVED
                                          │
                                          ▼
                                       CLOSED
```

---

# 20. 🗄️ SQL de diagnostic PostgreSQL

## Affectation active d'un incident

```sql
SELECT
    i.id AS incident_id,
    i.incident_status,
    ia.id AS assignment_id,
    ia.technician_id,
    ia.assignment_date,
    ia.active
FROM incidents i
LEFT JOIN incident_assignments ia
       ON ia.id = i.incident_assignment_id
WHERE i.id = 2;
```

---

## Incidents OPEN sans affectation

```sql
SELECT
    i.id,
    i.title,
    i.incident_status
FROM incidents i
WHERE i.incident_status = 'OPEN'
  AND i.incident_assignment_id IS NULL;
```

---

## Vérifier les incidents IN_PROGRESS d'un technicien

```sql
SELECT
    i.id,
    i.title,
    i.incident_status,
    ia.id AS assignment_id
FROM incidents i
JOIN incident_assignments ia
  ON ia.id = i.incident_assignment_id
WHERE ia.technician_id = 5
  AND ia.active = true
  AND i.incident_status = 'IN_PROGRESS';
```

---

## Historique métier d'un incident

```sql
SELECT
    ih.comment,
    u.username AS modified_by,
    ih.modification_date
FROM incident_history ih
JOIN users u
  ON u.id = ih.modified_by_id
WHERE ih.incident_id = 2
  AND (
        ih.comment LIKE 'Affectation%'
        OR ih.comment LIKE 'Désaffectation%'
      )
ORDER BY ih.modification_date;
```

---

# 21. ✅ Checklist de validation

| Test | Résultat attendu |
|---|---|
| Affectation incident OPEN | `200 OK` |
| Technicien gère plusieurs OPEN | `200 OK` |
| Double affectation | `409 Conflict` |
| Incident non OPEN | `409 Conflict` |
| Technicien avec IN_PROGRESS | `409 Conflict` |
| Technicien inexistant | `404 Not Found` |
| Désaffectation OPEN | `200 OK` |
| Réaffectation après désaffectation | `200 OK` |
| Désaffectation IN_PROGRESS | `409 Conflict` |
| Désaffectation sans affectation active | `404 Not Found` |
| Responsable absent du JSON | ✅ |
| Responsable récupéré depuis SecurityContext | ✅ |
| Affectation historisée | ✅ |
| Désaffectation historisée | ✅ |
| Endpoint assign réservé à RESPONSABLE | ✅ |
| Endpoint unassign réservé à RESPONSABLE | ✅ |
| Exceptions centralisées | ✅ |
| Relation `OneToOne` conservée | ✅ |
| Aucun changement du modèle DB demandé | ✅ |

---

# 22. 📌 Résumé

La conception initiale est conservée :

```text
Incident
   │
   │ OneToOne
   ▼
IncidentAssignment
   │
   │ ManyToOne
   ▼
Technician
```

La FK reste :

```text
incidents.incident_assignment_id
```

Les principales améliorations du ticket sont uniquement applicatives :

- suppression de `responsableId` dans les requêtes JSON ;
- récupération du responsable connecté depuis Spring Security ;
- protection des endpoints avec `@PreAuthorize`;
- exceptions métier dédiées ;
- gestion centralisée avec `GlobalExceptionHandler`;
- conservation de la logique `OneToOne` existante ;
- aucune migration de relation nécessaire.
