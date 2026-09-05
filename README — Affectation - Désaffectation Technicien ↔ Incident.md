# 📋 README — Ticket : Affectation / Désaffectation Technicien ↔ Incident

## 🎯 User Story

> **En tant que** Responsable,  
> **Je veux** affecter ou désaffecter un technicien disponible  
> **Afin d'assurer** le traitement d'un incident.

**Epic :** EPIC-4 Affectation  
**Estimation :** 1 jour

---

# 1. 📐 Règles métier

## Affectation

| # | Règle | Comportement si violée |
|---|---|---|
| 1 | Seuls les incidents au statut `OPEN` peuvent être affectés | `409 Conflict` |
| 2 | Un incident ne peut avoir qu'une seule affectation active à la fois | `409 Conflict` |
| 3 | Un technicien est non disponible s'il possède déjà un incident `IN_PROGRESS` actif | `409 Conflict` |
| 4 | Un technicien peut gérer plusieurs incidents `OPEN` simultanément | Autorisé |
| 5 | Chaque affectation est conservée dans `incident_assignments` | Historisation |
| 6 | L'action d'affectation est tracée dans `incident_history` | Historisation |
| 7 | Seul un utilisateur ayant le rôle `RESPONSABLE` peut effectuer l'affectation | `403 Forbidden` |

---

## Désaffectation

| # | Règle | Comportement si violée |
|---|---|---|
| 8 | Seul un incident `OPEN` peut être désaffecté | `409 Conflict` |
| 9 | L'incident doit avoir une affectation active | `404 Not Found` |
| 10 | La désaffectation est un soft delete : `active = false` | Historique conservé |
| 11 | L'ancienne affectation reste liée à l'incident | Audit conservé |
| 12 | La désaffectation est tracée dans `incident_history` | Historisation |
| 13 | Seul un utilisateur ayant le rôle `RESPONSABLE` peut désaffecter | `403 Forbidden` |

---

# 2. 🔐 Responsable authentifié

Le frontend **ne doit jamais envoyer l'identifiant du responsable**.

❌ À ne pas faire :

```json
{
  "technicianId": 5,
  "comment": "Incident urgent",
  "responsableId": 2
}
```

Le `responsableId` pourrait être falsifié par le client.

Le responsable ayant effectué l'action est automatiquement récupéré depuis le contexte Spring Security :

```java
SecurityContextHolder.getContext().getAuthentication()
```

Le body devient donc simplement :

```json
{
  "technicianId": 5,
  "comment": "Incident urgent"
}
```

Pour une désaffectation :

```json
{
  "comment": "Technicien redirigé vers un incident critique"
}
```

---

# 3. 🏗️ Modèle de données

Une affectation doit rester liée à l'incident même après sa désactivation.

On utilise donc la relation :

```text
Incident 1 ─────────────── N IncidentAssignment
                               │
                               │ N
                               ▼
                              User
                         role = TECHNICIEN
```

Exemple :

```text
Incident #10
│
├── Affectation #1
│      technician = TECHNICIEN_A
│      active = false
│
├── Affectation #2
│      technician = TECHNICIEN_B
│      active = false
│
└── Affectation #3
       technician = TECHNICIEN_C
       active = true
```

Une seule affectation peut être active à un instant donné.

Les anciennes affectations restent disponibles pour l'audit.

---

# 4. 🗂️ Entité `IncidentAssignment`

```java
@Entity
@Table(
    name = "incident_assignments",
    indexes = {
        @Index(
            name = "idx_assignment_incident_active",
            columnList = "incident_id, active"
        ),
        @Index(
            name = "idx_assignment_technician",
            columnList = "technician_id"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IncidentAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "assignment_date", nullable = false)
    private LocalDateTime assignmentDate;

    @Column(length = 1000)
    private String comment;

    @Column(nullable = false)
    private Boolean active;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "incident_id", nullable = false)
    private Incident incident;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "technician_id", nullable = false)
    private User technician;
}
```

---

# 5. 🗂️ Relation côté `Incident`

```java
@OneToMany(
    mappedBy = "incident",
    fetch = FetchType.LAZY
)
private List<IncidentAssignment> assignments = new ArrayList<>();
```

Il n'est plus nécessaire d'avoir :

```java
incident_assignment_id
```

directement dans la table `incidents`.

La clé étrangère est portée par :

```text
incident_assignments.incident_id
```

Cela permet de conserver toutes les affectations précédentes.

---

# 6. 📦 DTO

## `AssignIncidentRequest`

```java
@Data
public class AssignIncidentRequest {

    @NotNull(message = "Le technicien est obligatoire")
    private Long technicianId;

    @Size(max = 1000)
    private String comment;
}
```

---

## `UnassignIncidentRequest`

```java
@Data
public class UnassignIncidentRequest {

    @Size(max = 1000)
    private String comment;
}
```

Aucun `responsableId` n'est présent dans les DTO.

---

# 7. 📤 DTO de réponse

## `AssignmentResponse`

```java
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class AssignmentResponse {

    private Long assignmentId;

    private Long incidentId;

    private Long technicianId;

    private String technicianUsername;

    private LocalDateTime assignmentDate;

    private String comment;
}
```

---

# 8. 🗄️ Repository — `IncidentAssignmentRepository`

```java
public interface IncidentAssignmentRepository
        extends JpaRepository<IncidentAssignment, Long> {

    /**
     * Vérifie si l'incident possède déjà une affectation active.
     */
    boolean existsByIncident_IdAndActiveTrue(Long incidentId);

    /**
     * Retourne l'affectation active d'un incident.
     */
    Optional<IncidentAssignment>
        findByIncident_IdAndActiveTrue(Long incidentId);

    /**
     * Vérifie si un technicien possède déjà
     * un incident IN_PROGRESS avec une affectation active.
     */
    boolean existsByTechnician_IdAndActiveTrueAndIncident_IncidentStatus(
        Long technicianId,
        IncidentStatus status
    );
}
```

---

# 9. 🔒 Repository — verrouillage de l'incident

Un simple :

```java
existsByIncident_IdAndActiveTrue(...)
```

n'est pas suffisant pour garantir la protection contre deux requêtes concurrentes.

Exemple :

```text
Request A                         Request B

exists = false                   exists = false

create assignment                create assignment
```

Les deux requêtes pourraient théoriquement créer une affectation.

On verrouille donc l'incident pendant l'opération.

## `IncidentRepository`

```java
public interface IncidentRepository
        extends JpaRepository<Incident, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        SELECT i
        FROM Incident i
        WHERE i.id = :id
    """)
    Optional<Incident> findByIdForUpdate(
        @Param("id") Long id
    );
}
```

Workflow :

```text
Request A
   │
   ├── Lock Incident #10
   │
   ├── Vérification affectation
   │
   ├── Création affectation
   │
   └── COMMIT
         │
         ▼
Request B reprend
   │
   ├── Vérification affectation
   │
   └── 409 Conflict
```

---

# 10. 👤 Récupération de l'utilisateur connecté

## `CurrentUserService`

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
                || !authentication.isAuthenticated()) {

            throw new AuthenticationCredentialsNotFoundException(
                "Utilisateur non authentifié"
            );
        }

        String username = authentication.getName();

        return userRepository
            .findByUsername(username)
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Utilisateur authentifié introuvable : "
                        + username
                )
            );
    }
}
```

> `findByUsername()` peut être remplacé par `findByEmail()` si l'application utilise l'email comme identifiant dans le token.

---

# 11. ⚠️ Exceptions métier

On évite d'utiliser directement :

```java
ResponseStatusException
```

dans le service.

Le service doit uniquement lever des exceptions métier.

---

## `ResourceNotFoundException`

```java
public class ResourceNotFoundException
        extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
```

---

## `BusinessConflictException`

```java
public class BusinessConflictException
        extends RuntimeException {

    public BusinessConflictException(String message) {
        super(message);
    }
}
```

---

## `BadRequestException`

```java
public class BadRequestException
        extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
```

---

# 12. 🌐 Format des erreurs API

## `ApiError`

```java
@Builder
@Getter
public class ApiError {

    private LocalDateTime timestamp;

    private int status;

    private String error;

    private String message;

    private String path;
}
```

---

# 13. 🛡️ Global Exception Handler

## `GlobalExceptionHandler`

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

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(
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

        ApiError error = ApiError.builder()
            .timestamp(LocalDateTime.now())
            .status(status.value())
            .error(status.getReasonPhrase())
            .message(message)
            .path(path)
            .build();

        return ResponseEntity
            .status(status)
            .body(error);
    }
}
```

Exemple de réponse :

```json
{
  "timestamp": "2026-09-05T13:30:00",
  "status": 409,
  "error": "Conflict",
  "message": "L'incident 2 est déjà affecté à un technicien",
  "path": "/api/incidents/2/assign"
}
```

---

# 14. ⚙️ Service — `IncidentAssignmentService`

```java
@Service
@RequiredArgsConstructor
@Transactional
public class IncidentAssignmentService {

    private final IncidentRepository incidentRepository;

    private final IncidentAssignmentRepository assignmentRepository;

    private final UserRepository userRepository;

    private final IncidentHistoryRepository historyRepository;

    private final CurrentUserService currentUserService;

    // ============================================================
    // AFFECTATION
    // ============================================================

    public void assignTechnician(
            Long incidentId,
            AssignIncidentRequest request) {

        /*
         * 1. Récupérer et verrouiller l'incident.
         *
         * Le verrou protège contre deux affectations concurrentes.
         */
        Incident incident = incidentRepository
            .findByIdForUpdate(incidentId)
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Incident introuvable : id=" + incidentId
                )
            );

        /*
         * 2. Seuls les incidents OPEN sont affectables.
         */
        if (incident.getIncidentStatus()
                != IncidentStatus.OPEN) {

            throw new BusinessConflictException(
                "Seuls les incidents OPEN peuvent être affectés. "
                    + "Statut actuel : "
                    + incident.getIncidentStatus()
            );
        }

        /*
         * 3. Protection contre la double affectation.
         */
        if (assignmentRepository
                .existsByIncident_IdAndActiveTrue(incidentId)) {

            throw new BusinessConflictException(
                "L'incident "
                    + incidentId
                    + " est déjà affecté à un technicien. "
                    + "Veuillez d'abord le désaffecter."
            );
        }

        /*
         * 4. Vérifier que l'utilisateur demandé existe.
         */
        User technician = userRepository
            .findById(request.getTechnicianId())
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Technicien introuvable : id="
                        + request.getTechnicianId()
                )
            );

        /*
         * 5. Vérifier qu'il s'agit bien d'un technicien.
         */
        if (technician.getRole() != Role.TECHNICIEN) {

            throw new BadRequestException(
                "L'utilisateur id="
                    + request.getTechnicianId()
                    + " n'est pas un technicien."
            );
        }

        /*
         * 6. Vérifier la disponibilité du technicien.
         *
         * Un technicien avec un incident IN_PROGRESS
         * actif est considéré comme indisponible.
         */
        boolean unavailable = assignmentRepository
            .existsByTechnician_IdAndActiveTrueAndIncident_IncidentStatus(
                technician.getId(),
                IncidentStatus.IN_PROGRESS
            );

        if (unavailable) {

            throw new BusinessConflictException(
                "Le technicien '"
                    + technician.getUsername()
                    + "' est non disponible : "
                    + "il possède déjà un incident IN_PROGRESS."
            );
        }

        /*
         * 7. Récupérer automatiquement le responsable
         * ayant effectué l'action.
         */
        User responsable =
            currentUserService.getCurrentUser();

        /*
         * 8. Créer l'affectation.
         */
        IncidentAssignment assignment =
            IncidentAssignment.builder()
                .incident(incident)
                .technician(technician)
                .assignmentDate(LocalDateTime.now())
                .comment(request.getComment())
                .active(true)
                .build();

        assignmentRepository.save(assignment);

        /*
         * 9. Historiser l'action.
         */
        saveHistory(
            incident,
            responsable,
            "Affectation — Technicien : "
                + technician.getUsername()
                + (
                    request.getComment() != null
                    && !request.getComment().isBlank()

                    ? " | Note : "
                        + request.getComment()

                    : ""
                )
        );
    }

    // ============================================================
    // DÉSAFFECTATION
    // ============================================================

    public void unassignTechnician(
            Long incidentId,
            UnassignIncidentRequest request) {

        /*
         * 1. Récupérer et verrouiller l'incident.
         */
        Incident incident = incidentRepository
            .findByIdForUpdate(incidentId)
            .orElseThrow(() ->
                new ResourceNotFoundException(
                    "Incident introuvable : id=" + incidentId
                )
            );

        /*
         * 2. Désaffectation autorisée uniquement pour OPEN.
         */
        if (incident.getIncidentStatus()
                != IncidentStatus.OPEN) {

            throw new BusinessConflictException(
                "Impossible de désaffecter l'incident. "
                    + "Statut actuel : "
                    + incident.getIncidentStatus()
            );
        }

        /*
         * 3. Récupérer l'affectation active.
         */
        IncidentAssignment assignment =
            assignmentRepository
                .findByIncident_IdAndActiveTrue(incidentId)
                .orElseThrow(() ->
                    new ResourceNotFoundException(
                        "Aucune affectation active trouvée "
                            + "pour l'incident "
                            + incidentId
                    )
                );

        /*
         * 4. Responsable récupéré automatiquement
         * depuis Spring Security.
         */
        User responsable =
            currentUserService.getCurrentUser();

        String technicianName =
            assignment.getTechnician().getUsername();

        /*
         * 5. Soft delete.
         *
         * L'affectation reste liée à l'incident.
         */
        assignment.setActive(false);

        assignmentRepository.save(assignment);

        /*
         * 6. Historisation.
         */
        saveHistory(
            incident,
            responsable,
            "Désaffectation — Technicien : "
                + technicianName
                + " retiré de l'incident"
                + (
                    request.getComment() != null
                    && !request.getComment().isBlank()

                    ? " | Motif : "
                        + request.getComment()

                    : ""
                )
        );
    }

    // ============================================================
    // CONSULTATION DE L'AFFECTATION ACTIVE
    // ============================================================

    @Transactional(readOnly = true)
    public Optional<AssignmentResponse> getAssignment(
            Long incidentId) {

        /*
         * Vérifie également que l'incident existe.
         */
        if (!incidentRepository.existsById(incidentId)) {

            throw new ResourceNotFoundException(
                "Incident introuvable : id=" + incidentId
            );
        }

        return assignmentRepository
            .findByIncident_IdAndActiveTrue(incidentId)
            .map(assignment ->
                AssignmentResponse.builder()
                    .assignmentId(assignment.getId())
                    .incidentId(
                        assignment.getIncident().getId()
                    )
                    .technicianId(
                        assignment.getTechnician().getId()
                    )
                    .technicianUsername(
                        assignment
                            .getTechnician()
                            .getUsername()
                    )
                    .assignmentDate(
                        assignment.getAssignmentDate()
                    )
                    .comment(
                        assignment.getComment()
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

        history.setIncident(incident);

        /*
         * Pas de changement de statut dans cette opération.
         */
        history.setOldStatus(null);
        history.setNewStatus(null);

        history.setComment(comment);

        history.setModifiedBy(modifiedBy);

        history.setModificationDate(
            LocalDateTime.now()
        );

        historyRepository.save(history);
    }
}
```

---

# 15. 🎮 Controller

## `IncidentAssignmentController`

```java
@RestController
@RequestMapping("/api/incidents")
@RequiredArgsConstructor
public class IncidentAssignmentController {

    private final IncidentAssignmentService assignmentService;

    /**
     * Affecter un technicien.
     *
     * POST /api/incidents/{id}/assign
     */
    @PreAuthorize("hasRole('RESPONSABLE')")
    @PostMapping("/{id}/assign")
    public ResponseEntity<Void> assign(
            @PathVariable Long id,
            @RequestBody @Valid
            AssignIncidentRequest request) {

        assignmentService.assignTechnician(
            id,
            request
        );

        return ResponseEntity
            .ok()
            .build();
    }

    /**
     * Désaffecter le technicien actif.
     *
     * PATCH /api/incidents/{id}/unassign
     */
    @PreAuthorize("hasRole('RESPONSABLE')")
    @PatchMapping("/{id}/unassign")
    public ResponseEntity<Void> unassign(
            @PathVariable Long id,
            @RequestBody @Valid
            UnassignIncidentRequest request) {

        assignmentService.unassignTechnician(
            id,
            request
        );

        return ResponseEntity
            .ok()
            .build();
    }

    /**
     * Consulter l'affectation active.
     *
     * GET /api/incidents/{id}/assignment
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

# 16. 🔁 Endpoints

| Méthode | Endpoint | Autorisation | Body |
|---|---|---|---|
| `POST` | `/api/incidents/{id}/assign` | `RESPONSABLE` | `technicianId`, `comment` |
| `PATCH` | `/api/incidents/{id}/unassign` | `RESPONSABLE` | `comment` |
| `GET` | `/api/incidents/{id}/assignment` | Authentifié | Aucun |

---

# 17. 🧪 Tests fonctionnels

## ✅ CAS 1 — Affectation réussie

```http
POST /api/incidents/2/assign
Content-Type: application/json
Authorization: Bearer <token-responsable>
```

```json
{
  "technicianId": 5,
  "comment": "Affectation traitement urgent messagerie"
}
```

Résultat :

```text
200 OK
```

Base :

```text
incident_assignments

incident_id      = 2
technician_id    = 5
active           = true
assignment_date  = NOW()
```

Historique :

```text
Affectation — Technicien : technicien2
| Note : Affectation traitement urgent messagerie
```

`modifiedBy` correspond automatiquement au responsable connecté.

---

# 18. ✅ CAS 2 — Plusieurs incidents OPEN

Le technicien `5` possède déjà l'incident `2` en `OPEN`.

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

C'est autorisé.

---

# 19. ❌ CAS 3 — Double affectation

Incident `2` possède déjà une affectation active.

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

Réponse :

```json
{
  "status": 409,
  "error": "Conflict",
  "message": "L'incident 2 est déjà affecté à un technicien. Veuillez d'abord le désaffecter.",
  "path": "/api/incidents/2/assign"
}
```

---

# 20. ❌ CAS 4 — Incident non OPEN

Incident `1` :

```text
status = IN_PROGRESS
```

Requête :

```http
POST /api/incidents/1/assign
```

```json
{
  "technicianId": 5
}
```

Résultat :

```text
409 Conflict
```

---

# 21. ❌ CAS 5 — Technicien non disponible

Technicien `4` possède déjà un incident :

```text
IN_PROGRESS
```

Requête :

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

Message :

```text
Le technicien 'technicien1' est non disponible :
il possède déjà un incident IN_PROGRESS.
```

---

# 22. ❌ CAS 6 — Utilisateur non technicien

```http
POST /api/incidents/2/assign
```

```json
{
  "technicianId": 2
}
```

Si l'utilisateur `2` possède le rôle :

```text
RESPONSABLE
```

Résultat :

```text
400 Bad Request
```

---

# 23. ❌ CAS 7 — Technicien inexistant

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

# 24. ✅ CAS 8 — Désaffectation réussie

```http
PATCH /api/incidents/2/unassign
Content-Type: application/json
Authorization: Bearer <token-responsable>
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

Base :

```text
incident_assignments

id             = 100
incident_id    = 2
technician_id  = 5
active         = false
```

La ligne n'est pas supprimée.

Elle reste associée à l'incident `2`.

---

# 25. ✅ CAS 9 — Réaffectation après désaffectation

Après le CAS précédent, l'incident `2` n'a plus d'affectation active.

On utilise un technicien disponible, par exemple `6`.

```http
POST /api/incidents/2/assign
```

```json
{
  "technicianId": 6,
  "comment": "Réaffectation"
}
```

Résultat :

```text
200 OK
```

En base :

```text
Incident 2

Assignment #100
technician = 5
active = false

Assignment #101
technician = 6
active = true
```

---

# 26. ❌ CAS 10 — Désaffectation d'un IN_PROGRESS

```http
PATCH /api/incidents/1/unassign
```

```json
{}
```

Si :

```text
incident 1 = IN_PROGRESS
```

Résultat :

```text
409 Conflict
```

---

# 27. ❌ CAS 11 — Aucune affectation active

```http
PATCH /api/incidents/5/unassign
```

```json
{}
```

Si aucune affectation active n'existe :

```text
404 Not Found
```

---

# 28. 🔐 Test sécurité

Utilisateur connecté :

```text
role = TECHNICIEN
```

Essaie :

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

# 29. 🔁 Workflow global

```text
Incident OPEN
     │
     ▼
┌──────────────────────────────┐
│ POST /incidents/{id}/assign  │
└──────────────┬───────────────┘
               │
               ▼
       Affectation active
               │
               ├─────────────────────────┐
               │                         │
               │ changement technicien   │ démarrage traitement
               │                         │
               ▼                         ▼
 PATCH /{id}/unassign             Status IN_PROGRESS
               │                         │
               ▼                         │
       active = false                   │
               │                         │
               ▼                         │
       nouvelle affectation             │
                                         │
                                         ▼
                                  Technicien occupé
                                         │
                                         ▼
                                      RESOLVED
                                         │
                                         ▼
                                       CLOSED
```

À partir de :

```text
IN_PROGRESS
```

la désaffectation n'est plus autorisée.

---

# 30. 🧠 Règle de disponibilité technicien

La disponibilité dépend uniquement des incidents actifs `IN_PROGRESS`.

## Exemple 1

```text
Technicien A

Incident 1 → OPEN
Incident 2 → OPEN
Incident 3 → OPEN
```

Résultat :

```text
DISPONIBLE
```

Il peut recevoir d'autres incidents `OPEN`.

---

## Exemple 2

```text
Technicien A

Incident 1 → OPEN
Incident 2 → IN_PROGRESS
```

Résultat :

```text
NON DISPONIBLE
```

Il ne peut plus recevoir de nouvelle affectation.

---

# 31. 🗄️ SQL — Techniciens disponibles

```sql
SELECT
    u.id,
    u.username,

    COUNT(
        CASE
            WHEN i.incident_status = 'IN_PROGRESS'
             AND ia.active = true
            THEN 1
        END
    ) AS nb_in_progress,

    COUNT(
        CASE
            WHEN i.incident_status = 'OPEN'
             AND ia.active = true
            THEN 1
        END
    ) AS nb_open

FROM users u

LEFT JOIN incident_assignments ia
       ON ia.technician_id = u.id

LEFT JOIN incidents i
       ON i.id = ia.incident_id

WHERE u.role = 'TECHNICIEN'

GROUP BY
    u.id,
    u.username;
```

---

# 32. 🗄️ SQL — Incidents affectables

```sql
SELECT
    i.id,
    i.title,
    i.incident_status

FROM incidents i

WHERE i.incident_status = 'OPEN'

AND NOT EXISTS (

    SELECT 1

    FROM incident_assignments ia

    WHERE ia.incident_id = i.id
      AND ia.active = true
);
```

---

# 33. 🗄️ SQL — Affectation active

```sql
SELECT
    ia.id,
    ia.incident_id,
    ia.technician_id,
    ia.assignment_date,
    ia.comment

FROM incident_assignments ia

WHERE ia.incident_id = 2
  AND ia.active = true;
```

---

# 34. 🗄️ SQL — Historique complet des affectations

```sql
SELECT
    ia.id,
    ia.incident_id,
    u.username AS technician,
    ia.assignment_date,
    ia.active,
    ia.comment

FROM incident_assignments ia

JOIN users u
  ON u.id = ia.technician_id

WHERE ia.incident_id = 2

ORDER BY ia.assignment_date;
```

Exemple :

```text
id   technician    active
10   technicien1   false
14   technicien2   false
22   technicien3   true
```

---

# 35. 🗄️ SQL — Historique métier

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

# 36. ✅ Checklist de validation

| Test | Résultat |
|---|---|
| Affectation incident OPEN | `200` |
| Plusieurs OPEN pour un même technicien | `200` |
| Double affectation même incident | `409` |
| Incident non OPEN | `409` |
| Technicien avec IN_PROGRESS | `409` |
| Technicien inexistant | `404` |
| Utilisateur qui n'est pas TECHNICIEN | `400` |
| Désaffectation OPEN | `200` |
| Désaffectation IN_PROGRESS | `409` |
| Désaffectation sans affectation active | `404` |
| Réaffectation après désaffectation | `200` |
| Historique ancienne affectation conservé | ✅ |
| Affectation historisée | ✅ |
| Désaffectation historisée | ✅ |
| Responsable récupéré depuis Spring Security | ✅ |
| `responsableId` absent du JSON | ✅ |
| Endpoint assign protégé RESPONSABLE | ✅ |
| Endpoint unassign protégé RESPONSABLE | ✅ |
| Protection concurrence | ✅ |
| Exceptions centralisées | ✅ |

---

# 37. 📌 Résumé de l'architecture

```text
                         JWT / SecurityContext
                                  │
                                  ▼
                           RESPONSABLE
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
                 ASSIGN                      UNASSIGN
                    │                           │
                    ▼                           ▼
              Lock Incident               Lock Incident
                    │                           │
                    ▼                           ▼
              Vérifier OPEN                Vérifier OPEN
                    │                           │
                    ▼                           ▼
       Vérifier affectation active      Charger affectation active
                    │                           │
                    ▼                           ▼
        Vérifier TECHNICIEN              active = false
                    │                           │
                    ▼                           │
      Vérifier disponibilité                    │
                    │                           │
                    ▼                           │
          Créer affectation                     │
           active = true                        │
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                          INCIDENT_HISTORY
                                  │
                                  ▼
                       Responsable connecté
```

---

# 38. ✅ Résultat attendu

L'implémentation garantit :

- une seule affectation active par incident ;
- aucune perte de l'historique des anciennes affectations ;
- plusieurs incidents `OPEN` possibles pour un même technicien ;
- un technicien avec un `IN_PROGRESS` devient indisponible ;
- aucune désaffectation après démarrage de l'incident ;
- récupération automatique du responsable connecté ;
- aucun `responsableId` transmis par le frontend ;
- endpoints protégés avec Spring Security ;
- gestion centralisée des erreurs ;
- protection contre les affectations concurrentes ;
- traçabilité complète dans `incident_history` et `incident_assignments`.

## Workflow final

```text
OPEN
 │
 ├── Assign
 │      ↓
 │  Assignment active
 │      │
 │      ├── Unassign
 │      │      ↓
 │      │  active = false
 │      │      ↓
 │      │  Reassign possible
 │      │
 │      └── Start
 │             ↓
 └──────── IN_PROGRESS
                ↓
             RESOLVED
                ↓
              CLOSED
```