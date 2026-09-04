# 📋 README — Ticket : Affectation / Désaffectation Technicien ↔ Incident

## 🎯 User Story

> **En tant que** Responsable,  
> **Je veux** affecter ou désaffecter un technicien disponible  
> **Afin d'assurer** le traitement de l'incident.

**Epic :** EPIC-4 Affectation | **Estimation :** 1 jour

---

## 📐 Règles métier

### Affectation

| # | Règle | Comportement si violée |
|---|-------|------------------------|
| 1 | Seuls les incidents au statut **OPEN** peuvent être affectés | `409 Conflict` |
| 2 | Un incident ne peut avoir qu'**une seule affectation active** à la fois — protection double affectation | `409 Conflict` |
| 3 | Un technicien est **non disponible** s'il a déjà un incident **IN_PROGRESS** | `409 Conflict` |
| 4 | Un technicien peut gérer **plusieurs incidents OPEN** simultanément | — |
| 5 | L'affectation est **historisée** dans `incident_history` | — |

### Désaffectation

| # | Règle | Comportement si violée |
|---|-------|------------------------|
| 6 | On ne peut désaffecter que si l'incident est **OPEN** (pas encore démarré) | `409 Conflict` |
| 7 | L'incident doit **avoir une affectation active** pour être désaffecté | `404 Not Found` |
| 8 | La désaffectation est **soft** : `active = false` (historique conservé) | — |
| 9 | La désaffectation est **historisée** dans `incident_history` | — |

---

## 🏗️ Schéma de la protection double affectation

```
Incident 2 (OPEN)
    │
    ▼
POST /assign → existsByIncidentIdAndActiveTrue(2) ?
    │
    ├─ true  → ❌ 409 "Incident déjà affecté"   ← DOUBLE AFFECTATION BLOQUÉE
    │
    └─ false → ✅ Créer IncidentAssignment (active=true)
                   Lier incident.incidentAssignment = nouvelleAffectation
```

> **Clé :** le champ `active` sur `IncidentAssignment` est le verrou.  
> - `active = true`  → affectation en cours → tout nouveau POST /assign sur cet incident → `409`  
> - `active = false` → affectation annulée (désaffectation) → incident redevient affectable

---

## 🗂️ Entité — `IncidentAssignment`

```java
@Entity
@Table(name = "incident_assignments")
public class IncidentAssignment {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(name = "assignment_date")
    private LocalDateTime assignmentDate;

    private String comment;
    private Boolean active;           // true = active | false = désaffecté (soft delete)

    @OneToOne(mappedBy = "incidentAssignment")
    private Incident incident;        // FK portée par Incident.incident_assignment_id

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "technician_id", nullable = false)
    private Technician technician;    // Un technicien → N affectations
}
```

---

## ⚙️ Implémentation Backend

### 1. DTO

```java
// AssignIncidentRequest.java
@Data
public class AssignIncidentRequest {
    @NotNull
    private Long technicianId;
    private String comment;
    @NotNull
    private Long responsableId;
}

// UnassignIncidentRequest.java
@Data
public class UnassignIncidentRequest {
    private String comment;       // Motif de la désaffectation (optionnel)
    @NotNull
    private Long responsableId;
}
```

---

### 2. Repository — `IncidentAssignmentRepository`

```java
public interface IncidentAssignmentRepository extends JpaRepository<IncidentAssignment, Long> {

    // ── Protège la double affectation ──────────────────────────────────────
    // Retourne true si l'incident a DÉJÀ une affectation active
    boolean existsByIncidentIdAndActiveTrue(Long incidentId);

    // ── Récupère l'affectation active (pour désaffectation) ────────────────
    Optional<IncidentAssignment> findByIncidentIdAndActiveTrue(Long incidentId);

    // ── Vérifie disponibilité technicien ───────────────────────────────────
    // Retourne true si le technicien a un incident IN_PROGRESS
    boolean existsByTechnicianIdAndIncident_IncidentStatus(
        Long technicianId, IncidentStatus status
    );
}
```

---

### 3. Service — `IncidentAssignmentService`

```java
@Service
@RequiredArgsConstructor
@Transactional
public class IncidentAssignmentService {

    private final IncidentRepository           incidentRepository;
    private final IncidentAssignmentRepository assignmentRepository;
    private final UserRepository               userRepository;
    private final IncidentHistoryRepository    historyRepository;

    // ════════════════════════════════════════════════════════════
    //  AFFECTATION
    // ════════════════════════════════════════════════════════════
    public void assignTechnician(Long incidentId, AssignIncidentRequest request) {

        // 1. Récupérer l'incident
        Incident incident = incidentRepository.findById(incidentId)
            .orElseThrow(() -> new EntityNotFoundException(
                "Incident introuvable : id=" + incidentId));

        // 2. Vérifier statut OPEN
        if (incident.getIncidentStatus() != IncidentStatus.OPEN) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Seuls les incidents OPEN peuvent être affectés. " +
                "Statut actuel : " + incident.getIncidentStatus());
        }

        // 3. ── PROTECTION DOUBLE AFFECTATION ──────────────────────────────
        //    Si une affectation active existe déjà → on bloque immédiatement
        if (assignmentRepository.existsByIncidentIdAndActiveTrue(incidentId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "L'incident " + incidentId + " est déjà affecté à un technicien. " +
                "Veuillez d'abord le désaffecter avant une nouvelle affectation.");
        }

        // 4. Récupérer et valider le technicien
        User technician = userRepository.findById(request.getTechnicianId())
            .orElseThrow(() -> new EntityNotFoundException(
                "Technicien introuvable : id=" + request.getTechnicianId()));

        if (technician.getRole() != Role.TECHNICIEN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "L'utilisateur id=" + request.getTechnicianId() + " n'est pas un technicien.");
        }

        // 5. Vérifier disponibilité du technicien
        boolean occupé = assignmentRepository
            .existsByTechnicianIdAndIncident_IncidentStatus(
                request.getTechnicianId(), IncidentStatus.IN_PROGRESS);

        if (occupé) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Le technicien '" + technician.getUsername() +
                "' est non disponible : il a déjà un incident EN COURS (IN_PROGRESS).");
        }

        // 6. Récupérer le responsable
        User responsable = userRepository.findById(request.getResponsableId())
            .orElseThrow(() -> new EntityNotFoundException(
                "Responsable introuvable : id=" + request.getResponsableId()));

        // 7. Créer l'affectation
        IncidentAssignment assignment = new IncidentAssignment();
        assignment.setAssignmentDate(LocalDateTime.now());
        assignment.setComment(request.getComment());
        assignment.setActive(true);                    // ← verrou activé
        assignment.setTechnician(technician);

        incident.setIncidentAssignment(assignment);
        assignmentRepository.save(assignment);
        incidentRepository.save(incident);

        // 8. Historiser
        saveHistory(incident, responsable,
            "Affectation — Technicien : " + technician.getUsername() +
            (request.getComment() != null ? " | Note : " + request.getComment() : ""));
    }

    // ════════════════════════════════════════════════════════════
    //  DÉSAFFECTATION
    // ════════════════════════════════════════════════════════════
    public void unassignTechnician(Long incidentId, UnassignIncidentRequest request) {

        // 1. Récupérer l'incident
        Incident incident = incidentRepository.findById(incidentId)
            .orElseThrow(() -> new EntityNotFoundException(
                "Incident introuvable : id=" + incidentId));

        // 2. Vérifier statut OPEN — impossible de désaffecter si déjà démarré
        if (incident.getIncidentStatus() != IncidentStatus.OPEN) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Impossible de désaffecter : l'incident est déjà en cours ou clôturé. " +
                "Statut actuel : " + incident.getIncidentStatus());
        }

        // 3. Récupérer l'affectation active (404 si aucune)
        IncidentAssignment assignment = assignmentRepository
            .findByIncidentIdAndActiveTrue(incidentId)
            .orElseThrow(() -> new EntityNotFoundException(
                "Aucune affectation active trouvée pour l'incident " + incidentId));

        // 4. Récupérer le responsable
        User responsable = userRepository.findById(request.getResponsableId())
            .orElseThrow(() -> new EntityNotFoundException(
                "Responsable introuvable : id=" + request.getResponsableId()));

        String technicienNom = assignment.getTechnician().getUsername();

        // 5. Désaffecter — soft delete : active = false
        assignment.setActive(false);
        assignmentRepository.save(assignment);

        // 6. Détacher l'affectation de l'incident
        incident.setIncidentAssignment(null);
        incidentRepository.save(incident);

        // 7. Historiser
        saveHistory(incident, responsable,
            "Désaffectation — Technicien : " + technicienNom + " retiré de l'incident" +
            (request.getComment() != null ? " | Motif : " + request.getComment() : ""));
    }

    // ════════════════════════════════════════════════════════════
    //  HELPER — Historique
    // ════════════════════════════════════════════════════════════
    private void saveHistory(Incident incident, User modifiedBy, String comment) {
        IncidentHistory history = new IncidentHistory();
        history.setIncident(incident);
        history.setOldStatus(null);
        history.setNewStatus(null);
        history.setComment(comment);
        history.setModifiedBy(modifiedBy);
        history.setModificationDate(LocalDateTime.now());
        historyRepository.save(history);
    }
}
```

---

### 4. Controller — `IncidentAssignmentController`

```java
@RestController
@RequestMapping("/api/incidents")
@RequiredArgsConstructor
public class IncidentAssignmentController {

    private final IncidentAssignmentService assignmentService;

    /** POST /api/incidents/{id}/assign — Affecter un technicien */
    @PostMapping("/{id}/assign")
    public ResponseEntity<Void> assign(
            @PathVariable Long id,
            @RequestBody @Valid AssignIncidentRequest request) {

        assignmentService.assignTechnician(id, request);
        return ResponseEntity.ok().build();
    }

    /** PATCH /api/incidents/{id}/unassign — Désaffecter le technicien */
    @PatchMapping("/{id}/unassign")
    public ResponseEntity<Void> unassign(
            @PathVariable Long id,
            @RequestBody @Valid UnassignIncidentRequest request) {

        assignmentService.unassignTechnician(id, request);
        return ResponseEntity.ok().build();
    }

    /** GET /api/incidents/{id}/assignment — Consulter l'affectation active */
    @GetMapping("/{id}/assignment")
    public ResponseEntity<AssignmentResponse> getAssignment(@PathVariable Long id) {
        return assignmentService.getAssignment(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }
}
```

---

## 🔁 Endpoints résumé

| Méthode | URL | Rôle | Body |
|---------|-----|------|------|
| `POST`  | `/api/incidents/{id}/assign`   | RESPONSABLE | `technicianId, comment, responsableId` |
| `PATCH` | `/api/incidents/{id}/unassign` | RESPONSABLE | `comment (opt), responsableId` |
| `GET`   | `/api/incidents/{id}/assignment` | TOUS | — |

---

## 🧪 Scénarios de test complets

### ─── AFFECTATION ───

### ✅ CAS 1 — Affectation réussie

```
POST http://localhost:8080/api/incidents/2/assign
Content-Type: application/json

{
  "technicianId": 5,
  "comment": "Affectation traitement urgent messagerie",
  "responsableId": 2
}
```
**→ `200 OK`**  
En base : `incident_assignments.active = true`, `incidents.incident_assignment_id` lié, history tracé.

---

### ✅ CAS 2 — Même technicien, 2ème incident OPEN (autorisé)

```
POST http://localhost:8080/api/incidents/3/assign

{
  "technicianId": 5,
  "comment": "2ème incident pour technicien2",
  "responsableId": 2
}
```
**→ `200 OK`** ✅ (technicien5 n'a aucun IN_PROGRESS)

---

### ❌ CAS 3 — Double affectation sur le même incident

```
# Incident 2 est déjà affecté (CAS 1)
POST http://localhost:8080/api/incidents/2/assign

{
  "technicianId": 4,
  "responsableId": 2
}
```
**→ `409 Conflict`**
```
"L'incident 2 est déjà affecté à un technicien. Veuillez d'abord le désaffecter avant une nouvelle affectation."
```

---

### ❌ CAS 4 — Incident non OPEN (déjà IN_PROGRESS)

```
POST http://localhost:8080/api/incidents/1/assign

{
  "technicianId": 4,
  "responsableId": 2
}
```
**→ `409 Conflict`**
```
"Seuls les incidents OPEN peuvent être affectés. Statut actuel : IN_PROGRESS"
```

---

### ❌ CAS 5 — Technicien non disponible (a un IN_PROGRESS)

```
# technicien1 (id=4) a incident 1 en IN_PROGRESS
POST http://localhost:8080/api/incidents/2/assign

{
  "technicianId": 4,
  "responsableId": 2
}
```
**→ `409 Conflict`**
```
"Le technicien 'technicien1' est non disponible : il a déjà un incident EN COURS (IN_PROGRESS)."
```

---

### ─── DÉSAFFECTATION ───

### ✅ CAS 6 — Désaffectation réussie

```
PATCH http://localhost:8080/api/incidents/2/unassign
Content-Type: application/json

{
  "comment": "Technicien redirigé sur incident critique",
  "responsableId": 2
}
```
**→ `200 OK`**  
En base :
- `incident_assignments` : `active = false` (conservé pour l'audit)
- `incidents` : `incident_assignment_id = null` (incident redevient affectable)
- `incident_history` : `"Désaffectation — Technicien : technicien2 retiré de l'incident | Motif : ..."`

---

### ✅ CAS 7 — Réaffecter après désaffectation

```
# Après CAS 6 : incident 2 est libre → on peut affecter un autre technicien
POST http://localhost:8080/api/incidents/2/assign

{
  "technicianId": 4,
  "comment": "Réaffectation après libération",
  "responsableId": 2
}
```
**→ `200 OK`** ✅

---

### ❌ CAS 8 — Désaffecter un incident IN_PROGRESS (interdit)

```
PATCH http://localhost:8080/api/incidents/1/unassign

{
  "responsableId": 2
}
```
*(incident 1 est déjà IN_PROGRESS)*

**→ `409 Conflict`**
```
"Impossible de désaffecter : l'incident est déjà en cours ou clôturé. Statut actuel : IN_PROGRESS"
```

---

### ❌ CAS 9 — Désaffecter un incident sans affectation

```
PATCH http://localhost:8080/api/incidents/5/unassign

{
  "responsableId": 2
}
```
*(incident 5 n'a jamais été affecté)*

**→ `404 Not Found`**
```
"Aucune affectation active trouvée pour l'incident 5"
```

---

## ✅ Checklist de validation

| Test | Endpoint | Résultat attendu | ✅/❌ |
|------|----------|-----------------|-------|
| Affectation réussie (OPEN) | POST /assign | 200 OK | |
| Technicien gère 2 incidents OPEN | POST /assign x2 | 200 OK | |
| **Double affectation bloquée** | POST /assign (déjà affecté) | 409 Conflict | |
| Incident non OPEN | POST /assign | 409 Conflict | |
| Technicien avec IN_PROGRESS | POST /assign | 409 Conflict | |
| Technicien inexistant | POST /assign | 404 Not Found | |
| Désaffectation réussie (OPEN) | PATCH /unassign | 200 OK | |
| Réaffectation post-désaffectation | POST /assign | 200 OK | |
| Désaffecter un IN_PROGRESS | PATCH /unassign | 409 Conflict | |
| Désaffecter sans affectation | PATCH /unassign | 404 Not Found | |
| Historique affectation tracé | GET /history | comment présent | |
| Historique désaffectation tracé | GET /history | comment présent | |

---

## 🔁 Workflow complet avec désaffectation

```
[0a] Affecter technicien      POST  /api/incidents/{id}/assign
      │
      │   (si changement de technicien nécessaire avant démarrage)
      │
[0b] Désaffecter              PATCH /api/incidents/{id}/unassign
      │
      ▼
[1]  Qualifier l'incident     PATCH /api/incidents/{id}/qualify
      ↓
[2]  Statut → IN_PROGRESS     PATCH /api/incidents/{id}/status
     ← technicien non disponible pour nouvelles affectations
     ← désaffectation impossible à partir d'ici
      ↓
[3]  Statut → RESOLVED        PATCH /api/incidents/{id}/status
      ↓
[4]  Statut → CLOSED          PATCH /api/incidents/{id}/status
      ↓
[5]  Historique complet       GET   /api/incidents/{id}/history
```

---

## ❗ Erreurs fréquentes

| Erreur | Cause | Solution |
|--------|-------|----------|
| `409` /assign — "déjà affecté" | Double affectation | Faire PATCH /unassign d'abord |
| `409` /assign — statut | Incident non OPEN | Vérifier `incident_status` en base |
| `409` /assign — disponibilité | Technicien IN_PROGRESS | Choisir un autre technicien |
| `409` /unassign | Incident IN_PROGRESS ou + | Désaffectation impossible après démarrage |
| `404` /unassign | Pas d'affectation active | Vérifier `active=true` en base |
| FK violation | `incident_assignment_id` absent | Appliquer migration V6 |

---

## 🗄️ Requêtes SQL de diagnostic

```sql
-- Disponibilité des techniciens
SELECT u.username,
       COUNT(CASE WHEN i.incident_status = 'IN_PROGRESS' THEN 1 END) AS nb_en_cours,
       COUNT(CASE WHEN i.incident_status = 'OPEN' AND ia.active = 1 THEN 1 END) AS nb_open_assignes
FROM users u
LEFT JOIN incident_assignments ia ON ia.technician_id = u.id AND ia.active = 1
LEFT JOIN incidents i ON i.incident_assignment_id = ia.id
WHERE u.role = 'TECHNICIEN'
GROUP BY u.username;

-- Incidents affectables (OPEN + pas d'affectation active)
SELECT i.id, i.title, i.incident_status
FROM incidents i
LEFT JOIN incident_assignments ia ON ia.id = i.incident_assignment_id AND ia.active = 1
WHERE i.incident_status = 'OPEN'
  AND ia.id IS NULL;

-- Historique affectations/désaffectations d'un incident
SELECT ih.comment, u.username AS modifie_par, ih.modification_date
FROM incident_history ih
JOIN users u ON u.id = ih.modified_by_id
WHERE ih.incident_id = 2
  AND ih.comment LIKE '%ffectation%'
ORDER BY ih.modification_date;
```
