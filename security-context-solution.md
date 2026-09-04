# Solution SecurityContextHolder — Tous les services

## Ce qui change

| Avant (temporaire) | Après (JWT) |
|---|---|
| `userId` dans le body | Extrait du token JWT |
| `userRepository.findById(request.getUserId())` | `userRepository.findByUsername(username)` |
| Client choisit l'identité ❌ | Serveur extrait l'identité ✅ |

---

## 1. DTOs mis à jour — supprimer userId

### UpdateIncidentQualificationRequest.java

```java
package com.telecom.telecom.dto;

import com.telecom.telecom.dao.enums.IncidentType;
import com.telecom.telecom.dao.enums.Priority;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UpdateIncidentQualificationRequest {

    @NotNull(message = "Le type d'incident est obligatoire")
    private IncidentType incidentType;

    @NotNull(message = "La priorité est obligatoire")
    private Priority priority;

    // ← userId supprimé
}
```

### UpdateIncidentStatusRequest.java

```java
package com.telecom.telecom.dto;

import com.telecom.telecom.dao.enums.IncidentStatus;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UpdateIncidentStatusRequest {

    @NotNull(message = "Le nouveau statut est obligatoire")
    private IncidentStatus newStatus;

    private String comment; // optionnel

    // ← userId supprimé
}
```

---

## 2. Méthode utilitaire — éviter la répétition

Ajoute cette méthode **privée** dans `IncidentServiceImplementation` :

```java
/**
 * Récupère l'utilisateur connecté depuis le token JWT
 * via SecurityContextHolder
 */
private User getCurrentUser() {
    String username = SecurityContextHolder
            .getContext()
            .getAuthentication()
            .getName();

    return userRepository.findByUsername(username)
            .orElseThrow(() -> new UserNotFoundException(username));
}
```

---

## 3. qualifyIncident() — mis à jour

```java
@Override
@Transactional
public void qualifyIncident(Long incidentId,
                            UpdateIncidentQualificationRequest request) {

    // 1. Récupérer l'incident
    Incident incident = incidentRepository.findById(incidentId)
            .orElseThrow(() -> new IncidentNotFoundException(incidentId));

    // 2. Validation métier — statut terminal ?
    if (TERMINAL_STATUSES.contains(incident.getIncidentStatus())) {
        throw new InvalidIncidentStateException(
                "Impossible de qualifier un incident au statut : "
                + incident.getIncidentStatus());
    }

    // 3. Récupérer l'utilisateur connecté ← plus de userId dans le body
    User currentUser = getCurrentUser();

    // 4. Sauvegarder les anciennes valeurs
    String oldType     = incident.getIncidentType() != null
                         ? incident.getIncidentType().name() : "N/A";
    String oldPriority = incident.getPriority() != null
                         ? incident.getPriority().name() : "N/A";

    // 5. Appliquer la qualification
    incident.setIncidentType(request.getIncidentType());
    incident.setPriority(request.getPriority());
    incidentRepository.save(incident);

    // 6. Historiser
    IncidentHistory history = new IncidentHistory();
    history.setIncident(incident);
    history.setUser(currentUser);           // ← user du token
    history.setOldStatus(null);
    history.setNewStatus(null);
    history.setComment(String.format(
            "Qualification — Type : %s → %s | Priorité : %s → %s",
            oldType,     request.getIncidentType().name(),
            oldPriority, request.getPriority().name()));

    incidentHistoryRepository.save(history);

    log.info("Incident {} qualifié par {} → type={} priorité={}",
             incidentId, currentUser.getUsername(),
             request.getIncidentType(), request.getPriority());
}
```

---

## 4. updateIncidentStatus() — mis à jour

```java
@Override
@Transactional
public void updateIncidentStatus(Long incidentId,
                                  UpdateIncidentStatusRequest request) {

    // 1. Récupérer l'incident
    Incident incident = incidentRepository.findById(incidentId)
            .orElseThrow(() -> new IncidentNotFoundException(incidentId));

    // 2. Récupérer l'utilisateur connecté ← plus de userId dans le body
    User currentUser = getCurrentUser();

    IncidentStatus oldStatus = incident.getIncidentStatus();
    IncidentStatus newStatus = request.getNewStatus();

    // 3. Contrôle du workflow
    WorkflowValidator.validate(oldStatus, newStatus);

    // 4. Appliquer le nouveau statut
    incident.setIncidentStatus(newStatus);
    incidentRepository.save(incident);

    // 5. Historiser
    String comment = request.getComment() != null
            ? request.getComment()
            : String.format("Changement de statut : %s → %s",
                            oldStatus, newStatus);

    IncidentHistory history = new IncidentHistory();
    history.setIncident(incident);
    history.setUser(currentUser);           // ← user du token
    history.setOldStatus(oldStatus);
    history.setNewStatus(newStatus);
    history.setComment(comment);
    incidentHistoryRepository.save(history);

    log.info("Incident {} : {} → {} par {}",
             incidentId, oldStatus, newStatus, currentUser.getUsername());
}
```

---

## 5. Tests — mocker SecurityContextHolder

```java
// Dans chaque classe de test, ajouter :

@Mock private SecurityContext    securityContext;
@Mock private Authentication     authentication;

@BeforeEach
void setUp() {
    // Simuler un user connecté
    when(authentication.getName()).thenReturn("responsable1");
    when(securityContext.getAuthentication()).thenReturn(authentication);
    SecurityContextHolder.setContext(securityContext);

    // Mock userRepository
    when(userRepository.findByUsername("responsable1"))
            .thenReturn(Optional.of(responsable));
}

@AfterEach
void tearDown() {
    SecurityContextHolder.clearContext();
}
```

---

## 6. Appel Postman — avec JWT

```
PATCH /api/incidents/1/qualify
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
Content-Type: application/json

{
  "incidentType": "NETWORK",
  "priority": "HIGH"
}
```

```
PATCH /api/incidents/1/status
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
Content-Type: application/json

{
  "newStatus": "IN_PROGRESS",
  "comment": "Prise en charge"
}
```

**Plus de `userId` dans aucun body** ✅

---

## Résumé des fichiers modifiés

```
✅ UpdateIncidentQualificationRequest.java  ← userId supprimé
✅ UpdateIncidentStatusRequest.java         ← userId supprimé
✅ IncidentServiceImplementation.java       ← getCurrentUser() + 2 méthodes
✅ IncidentServiceQualifyTest.java          ← mock SecurityContext
✅ IncidentStatusServiceTest.java           ← mock SecurityContext
```
