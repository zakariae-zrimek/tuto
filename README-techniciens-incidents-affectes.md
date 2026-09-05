# 📋 README — Consultation des incidents affectés par technicien

## 🎯 Objectif

> **En tant que** Responsable,  
> **Je veux** consulter la liste des techniciens avec les incidents actuellement affectés à chacun,  
> **Afin de visualiser leur charge et les détails de chaque incident.**

---

# 1. ✅ Conception existante conservée

Aucun changement de base de données n'est nécessaire.

La conception actuelle reste :

```text
User
 ▲
 │ extends
 │
Technician
 │
 │ OneToMany
 ▼
IncidentAssignment
 │
 │ OneToOne inverse
 ▼
Incident
```

Côté `Technician` :

```java
@OneToMany(mappedBy = "technician", fetch = FetchType.LAZY)
private List<IncidentAssignment> incidentAssignments = new ArrayList<>();
```

Côté `IncidentAssignment` :

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "technician_id", nullable = false)
private Technician technician;

@OneToOne(mappedBy = "incidentAssignment")
private Incident incident;
```

Côté `Incident` :

```java
@OneToOne
@JoinColumn(name = "incident_assignment_id")
private IncidentAssignment incidentAssignment;
```

La FK reste :

```text
incidents.incident_assignment_id
```

Aucune migration Flyway n'est nécessaire.

---

# 2. 🎯 Résultat attendu

Exemple :

```text
Technicien 1
 ├── Incident 10
 ├── Incident 14
 └── Incident 18

Technicien 2
 ├── Incident 21
 └── Incident 25

Technicien 3
 └── Aucun incident affecté
```

Pour chaque technicien :

- `technicianId`
- `username`
- `firstName`
- `lastName`
- `specialty`
- `available`
- nombre d'incidents affectés
- liste des incidents affectés

Pour chaque incident :

- `incidentId`
- `title`
- `status`
- `assignmentId`
- `assignmentDate`
- `assignmentComment`

Seules les affectations `active = true` sont retournées.

---

# 3. 🌐 Endpoints

## Tous les techniciens avec leurs incidents

```http
GET /api/technicians/incidents
```

Autorisation :

```text
RESPONSABLE
```

## Un technicien avec ses incidents

```http
GET /api/technicians/{technicianId}/incidents
```

Exemple :

```http
GET /api/technicians/5/incidents
```

---

# 4. 📦 DTO — détail d'un incident affecté

## `AssignedIncidentResponse.java`

```java
package com.telecom.telecom.dto.response;

import com.telecom.telecom.dao.enums.IncidentStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssignedIncidentResponse {

    private Long incidentId;
    private String title;
    private IncidentStatus status;

    private Long assignmentId;
    private LocalDateTime assignmentDate;
    private String assignmentComment;
}
```

> Si ton entité `Incident` contient d'autres champs utiles (`description`, `priority`, `category`, `creationDate`, etc.), tu peux les ajouter dans ce DTO.

---

# 5. 📦 DTO — technicien avec ses incidents

## `TechnicianIncidentsResponse.java`

```java
package com.telecom.telecom.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TechnicianIncidentsResponse {

    private Long technicianId;

    private String username;
    private String firstName;
    private String lastName;

    private String specialty;
    private Boolean available;

    private int assignedIncidentsCount;

    private List<AssignedIncidentResponse> incidents;
}
```

---

# 6. 🗄️ `TechnicianRepository`

```java
package com.telecom.telecom.repository;

import com.telecom.telecom.dao.entity.Technician;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TechnicianRepository
        extends JpaRepository<Technician, Long> {

    List<Technician> findAllByOrderByUsernameAsc();
}
```

---

# 7. 🗄️ `IncidentAssignmentRepository`

On conserve les méthodes existantes et on ajoute deux méthodes de consultation.

```java
package com.telecom.telecom.repository;

import com.telecom.telecom.dao.entity.IncidentAssignment;
import com.telecom.telecom.dao.enums.IncidentStatus;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface IncidentAssignmentRepository
        extends JpaRepository<IncidentAssignment, Long> {

    // ============================================================
    // MÉTHODES EXISTANTES
    // ============================================================

    boolean existsByIncidentIdAndActiveTrue(
        Long incidentId
    );

    Optional<IncidentAssignment>
        findByIncidentIdAndActiveTrue(
            Long incidentId
        );

    boolean existsByTechnicianIdAndIncident_IncidentStatus(
        Long technicianId,
        IncidentStatus status
    );


    // ============================================================
    // NOUVEAU :
    // toutes les affectations actives
    // ============================================================

    @Query("""
        SELECT ia
        FROM IncidentAssignment ia

        JOIN FETCH ia.technician technician
        JOIN FETCH ia.incident incident

        WHERE ia.active = true

        ORDER BY
            technician.username ASC,
            ia.assignmentDate DESC
    """)
    List<IncidentAssignment>
        findAllActiveWithTechnicianAndIncident();


    // ============================================================
    // NOUVEAU :
    // affectations actives d'un technicien précis
    // ============================================================

    @Query("""
        SELECT ia
        FROM IncidentAssignment ia

        JOIN FETCH ia.technician technician
        JOIN FETCH ia.incident incident

        WHERE technician.id = :technicianId
          AND ia.active = true

        ORDER BY ia.assignmentDate DESC
    """)
    List<IncidentAssignment>
        findActiveByTechnicianIdWithIncident(
            @Param("technicianId")
            Long technicianId
        );
}
```

---

# 8. 💡 Pourquoi `JOIN FETCH` ?

Avec tes relations `LAZY`, sans `JOIN FETCH`, on peut provoquer plusieurs requêtes supplémentaires :

```text
1 requête affectations
+
N requêtes techniciens
+
N requêtes incidents
```

Avec :

```java
JOIN FETCH ia.technician
JOIN FETCH ia.incident
```

on récupère directement les données utiles.

---

# 9. ⚙️ Service

## `TechnicianIncidentService.java`

```java
package com.telecom.telecom.service;

import com.telecom.telecom.dao.entity.Incident;
import com.telecom.telecom.dao.entity.IncidentAssignment;
import com.telecom.telecom.dao.entity.Technician;

import com.telecom.telecom.dto.response.AssignedIncidentResponse;
import com.telecom.telecom.dto.response.TechnicianIncidentsResponse;

import com.telecom.telecom.exception.ResourceNotFoundException;

import com.telecom.telecom.repository.IncidentAssignmentRepository;
import com.telecom.telecom.repository.TechnicianRepository;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TechnicianIncidentService {

    private final TechnicianRepository technicianRepository;
    private final IncidentAssignmentRepository assignmentRepository;


    // ============================================================
    // TOUS LES TECHNICIENS + LEURS INCIDENTS
    // ============================================================

    public List<TechnicianIncidentsResponse>
        getAllTechniciansWithIncidents() {

        // 1. Tous les techniciens, même ceux sans incident
        List<Technician> technicians =
            technicianRepository.findAllByOrderByUsernameAsc();

        // 2. Toutes les affectations actives
        List<IncidentAssignment> activeAssignments =
            assignmentRepository
                .findAllActiveWithTechnicianAndIncident();

        // 3. Regrouper les affectations par technicien
        Map<Long, List<IncidentAssignment>> assignmentsByTechnician =
            activeAssignments
                .stream()
                .collect(
                    Collectors.groupingBy(
                        assignment ->
                            assignment
                                .getTechnician()
                                .getId()
                    )
                );

        // 4. Construire la réponse
        return technicians
            .stream()
            .map(technician -> {

                List<IncidentAssignment> assignments =
                    assignmentsByTechnician
                        .getOrDefault(
                            technician.getId(),
                            Collections.emptyList()
                        );

                List<AssignedIncidentResponse> incidents =
                    assignments
                        .stream()
                        .map(this::toIncidentResponse)
                        .toList();

                return TechnicianIncidentsResponse
                    .builder()

                    .technicianId(
                        technician.getId()
                    )

                    .username(
                        technician.getUsername()
                    )

                    .firstName(
                        technician.getFirstName()
                    )

                    .lastName(
                        technician.getLastName()
                    )

                    .specialty(
                        technician.getSpecialty()
                    )

                    .available(
                        technician.getAvailable()
                    )

                    .assignedIncidentsCount(
                        incidents.size()
                    )

                    .incidents(
                        incidents
                    )

                    .build();
            })
            .toList();
    }


    // ============================================================
    // UN TECHNICIEN + SES INCIDENTS
    // ============================================================

    public TechnicianIncidentsResponse
        getTechnicianWithIncidents(
            Long technicianId
        ) {

        // 1. Vérifier que le technicien existe
        Technician technician =
            technicianRepository
                .findById(technicianId)
                .orElseThrow(() ->
                    new ResourceNotFoundException(
                        "Technicien introuvable : id="
                            + technicianId
                    )
                );

        // 2. Récupérer ses affectations actives
        List<IncidentAssignment> assignments =
            assignmentRepository
                .findActiveByTechnicianIdWithIncident(
                    technicianId
                );

        // 3. Mapper les incidents
        List<AssignedIncidentResponse> incidents =
            assignments
                .stream()
                .map(this::toIncidentResponse)
                .toList();

        // 4. Retour
        return TechnicianIncidentsResponse
            .builder()

            .technicianId(
                technician.getId()
            )

            .username(
                technician.getUsername()
            )

            .firstName(
                technician.getFirstName()
            )

            .lastName(
                technician.getLastName()
            )

            .specialty(
                technician.getSpecialty()
            )

            .available(
                technician.getAvailable()
            )

            .assignedIncidentsCount(
                incidents.size()
            )

            .incidents(
                incidents
            )

            .build();
    }


    // ============================================================
    // MAPPER
    // ============================================================

    private AssignedIncidentResponse
        toIncidentResponse(
            IncidentAssignment assignment
        ) {

        Incident incident =
            assignment.getIncident();

        return AssignedIncidentResponse
            .builder()

            .incidentId(
                incident.getId()
            )

            .title(
                incident.getTitle()
            )

            .status(
                incident.getIncidentStatus()
            )

            .assignmentId(
                assignment.getId()
            )

            .assignmentDate(
                assignment.getAssignmentDate()
            )

            .assignmentComment(
                assignment.getComment()
            )

            .build();
    }
}
```

---

# 10. 🎮 Controller

## `TechnicianIncidentController.java`

```java
package com.telecom.telecom.controller;

import com.telecom.telecom.dto.response.TechnicianIncidentsResponse;
import com.telecom.telecom.service.TechnicianIncidentService;

import lombok.RequiredArgsConstructor;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/technicians")
@RequiredArgsConstructor
public class TechnicianIncidentController {

    private final TechnicianIncidentService
        technicianIncidentService;


    // ============================================================
    // TOUS LES TECHNICIENS
    // ============================================================

    /**
     * GET /api/technicians/incidents
     *
     * Tous les techniciens avec leurs incidents
     * actuellement affectés.
     */
    @PreAuthorize("hasRole('RESPONSABLE')")
    @GetMapping("/incidents")
    public ResponseEntity<
            List<TechnicianIncidentsResponse>>
        getAllTechniciansWithIncidents() {

        return ResponseEntity.ok(
            technicianIncidentService
                .getAllTechniciansWithIncidents()
        );
    }


    // ============================================================
    // UN TECHNICIEN
    // ============================================================

    /**
     * GET /api/technicians/{technicianId}/incidents
     *
     * Un technicien avec ses incidents actifs.
     */
    @PreAuthorize("hasRole('RESPONSABLE')")
    @GetMapping("/{technicianId}/incidents")
    public ResponseEntity<TechnicianIncidentsResponse>
        getTechnicianWithIncidents(
            @PathVariable Long technicianId
        ) {

        return ResponseEntity.ok(
            technicianIncidentService
                .getTechnicianWithIncidents(
                    technicianId
                )
        );
    }
}
```

---

# 11. 📤 Exemple de réponse — tous les techniciens

Requête :

```http
GET /api/technicians/incidents
Authorization: Bearer <TOKEN_RESPONSABLE>
```

Réponse :

```json
[
  {
    "technicianId": 4,
    "username": "technicien1",
    "firstName": "Ahmed",
    "lastName": "Alami",
    "specialty": "Réseau",
    "available": false,
    "assignedIncidentsCount": 2,
    "incidents": [
      {
        "incidentId": 1,
        "title": "Coupure réseau agence",
        "status": "IN_PROGRESS",
        "assignmentId": 15,
        "assignmentDate": "2026-09-05T09:30:00",
        "assignmentComment": "Incident prioritaire"
      },
      {
        "incidentId": 8,
        "title": "Problème accès VPN",
        "status": "OPEN",
        "assignmentId": 18,
        "assignmentDate": "2026-09-05T08:15:00",
        "assignmentComment": "À traiter après incident réseau"
      }
    ]
  },
  {
    "technicianId": 5,
    "username": "technicien2",
    "firstName": "Yassine",
    "lastName": "Benali",
    "specialty": "Messagerie",
    "available": true,
    "assignedIncidentsCount": 1,
    "incidents": [
      {
        "incidentId": 3,
        "title": "Erreur messagerie utilisateur",
        "status": "OPEN",
        "assignmentId": 19,
        "assignmentDate": "2026-09-05T10:00:00",
        "assignmentComment": "Vérifier configuration Outlook"
      }
    ]
  },
  {
    "technicianId": 6,
    "username": "technicien3",
    "firstName": "Mehdi",
    "lastName": "Karim",
    "specialty": "Système",
    "available": true,
    "assignedIncidentsCount": 0,
    "incidents": []
  }
]
```

---

# 12. 📤 Exemple — un technicien précis

Requête :

```http
GET /api/technicians/4/incidents
Authorization: Bearer <TOKEN_RESPONSABLE>
```

Réponse :

```json
{
  "technicianId": 4,
  "username": "technicien1",
  "firstName": "Ahmed",
  "lastName": "Alami",
  "specialty": "Réseau",
  "available": false,
  "assignedIncidentsCount": 2,
  "incidents": [
    {
      "incidentId": 1,
      "title": "Coupure réseau agence",
      "status": "IN_PROGRESS",
      "assignmentId": 15,
      "assignmentDate": "2026-09-05T09:30:00",
      "assignmentComment": "Incident prioritaire"
    },
    {
      "incidentId": 8,
      "title": "Problème accès VPN",
      "status": "OPEN",
      "assignmentId": 18,
      "assignmentDate": "2026-09-05T08:15:00",
      "assignmentComment": "À traiter après incident réseau"
    }
  ]
}
```

---

# 13. ❌ Technicien inexistant

Requête :

```http
GET /api/technicians/99999/incidents
```

Résultat :

```text
404 Not Found
```

Exemple :

```json
{
  "timestamp": "2026-09-05T15:00:00",
  "status": 404,
  "error": "Not Found",
  "message": "Technicien introuvable : id=99999",
  "path": "/api/technicians/99999/incidents"
}
```

L'exception est traitée par le `GlobalExceptionHandler` du ticket précédent.

---

# 14. 🔐 Sécurité

Les deux endpoints sont réservés au responsable :

```java
@PreAuthorize("hasRole('RESPONSABLE')")
```

Donc :

```text
RESPONSABLE
     │
     ├── GET /api/technicians/incidents
     │
     └── GET /api/technicians/{id}/incidents
```

Un utilisateur non autorisé reçoit :

```text
403 Forbidden
```

---

# 15. 🧠 Affectations actives uniquement

La requête contient :

```java
WHERE ia.active = true
```

Donc une ancienne affectation désactivée :

```text
active = false
```

n'apparaît plus dans la liste courante du technicien.

Exemple :

```text
Technicien 1
│
├── Incident 1 → active=true
├── Incident 2 → active=true
└── Ancienne affectation → active=false
```

La réponse contient uniquement :

```text
Incident 1
Incident 2
```

---

# 16. 🗄️ SQL PostgreSQL de contrôle

Comme `User` utilise `InheritanceType.JOINED`, la table `technicians` reprend normalement la PK de `users`.

Exemple de requête de contrôle :

```sql
SELECT
    u.id AS technician_id,
    u.username,
    u.first_name,
    u.last_name,
    t.specialty,
    t.available,

    ia.id AS assignment_id,
    ia.assignment_date,
    ia.comment AS assignment_comment,

    i.id AS incident_id,
    i.title,
    i.incident_status

FROM technicians t

JOIN users u
  ON u.id = t.id

LEFT JOIN incident_assignments ia
  ON ia.technician_id = t.id
 AND ia.active = true

LEFT JOIN incidents i
  ON i.incident_assignment_id = ia.id

ORDER BY
    u.username,
    ia.assignment_date DESC;
```

> Vérifier le nom réel des colonnes générées par tes migrations (`id`, `user_id`, etc.) avant d'utiliser directement cette requête.

---

# 17. 🧪 Scénarios de test

## ✅ CAS 1 — technicien avec plusieurs incidents

Technicien :

```text
id = 4
```

Affectations :

```text
Incident 1 → IN_PROGRESS → active=true
Incident 8 → OPEN        → active=true
```

Requête :

```http
GET /api/technicians/4/incidents
```

Résultat :

```text
200 OK
assignedIncidentsCount = 2
```

---

## ✅ CAS 2 — technicien sans incident

Technicien :

```text
id = 6
```

Aucune affectation active.

Résultat :

```json
{
  "technicianId": 6,
  "assignedIncidentsCount": 0,
  "incidents": []
}
```

---

## ✅ CAS 3 — après désaffectation

Avant :

```text
Incident 8 → active=true
```

Après :

```http
PATCH /api/incidents/8/unassign
```

L'affectation devient :

```text
active=false
```

Puis :

```http
GET /api/technicians/4/incidents
```

L'incident `8` ne doit plus apparaître.

---

## ✅ CAS 4 — après réaffectation

Incident `8` est réaffecté au technicien `5`.

Alors :

```http
GET /api/technicians/4/incidents
```

Incident `8` :

```text
absent
```

Et :

```http
GET /api/technicians/5/incidents
```

Incident `8` :

```text
présent
```

---

# 18. ✅ Checklist

| Test | Résultat |
|---|---|
| Afficher tous les techniciens | ✅ |
| Afficher technicien sans incident | ✅ |
| Afficher incidents actifs par technicien | ✅ |
| Afficher détails de chaque incident | ✅ |
| Afficher date d'affectation | ✅ |
| Afficher commentaire d'affectation | ✅ |
| Afficher nombre d'incidents | ✅ |
| Affectation inactive non affichée | ✅ |
| Endpoint pour un seul technicien | ✅ |
| Technicien inexistant → `404` | ✅ |
| Accès réservé au `RESPONSABLE` | ✅ |
| Aucun changement DB | ✅ |
| `OneToOne` existant conservé | ✅ |

---

# 19. 📌 Architecture finale

```text
                  GET /api/technicians/incidents
                               │
                               ▼
                TechnicianIncidentController
                               │
                               ▼
                  TechnicianIncidentService
                     │                   │
                     ▼                   ▼
           TechnicianRepository   AssignmentRepository
                     │                   │
                     │                   ▼
                     │             active = true
                     │                   │
                     └─────────┬─────────┘
                               │
                               ▼
                TechnicianIncidentsResponse
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
          Technicien       Incident 1     Incident 2
                           + détails       + détails
```

---

# 20. ✅ Résumé

Cette fonctionnalité est uniquement une consultation.

Elle ne change pas la conception actuelle :

```text
Technician
    │
    │ OneToMany
    ▼
IncidentAssignment
    │
    │ OneToOne
    ▼
Incident
```

Les endpoints ajoutés sont :

```http
GET /api/technicians/incidents
GET /api/technicians/{technicianId}/incidents
```

Ils permettent au responsable de voir :

```text
Technicien
   ├── informations du technicien
   ├── nombre d'incidents affectés
   └── incidents
         ├── id
         ├── titre
         ├── statut
         ├── date d'affectation
         └── commentaire d'affectation
```

Aucune migration Flyway n'est nécessaire.
