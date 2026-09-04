# US — Modifier le statut d'un incident (Technicien)

## Critères d'acceptation
- ✅ Respect du workflow (transitions définies)
- ✅ Contrôle des transitions (blocage si transition invalide)
- ✅ Historisation des changements (oldStatus + newStatus remplis)

---

## 1. Workflow autorisé

```
OPEN ──────────► IN_PROGRESS
                     │
                     ▼
              OPEN ◄─┤ (réouverture)
                     │
                     ▼
                 RESOLVED
                     │
                     ▼
                  CLOSED
```

| Statut actuel | Transitions autorisées         |
|---------------|-------------------------------|
| OPEN          | → IN_PROGRESS                 |
| IN_PROGRESS   | → RESOLVED, → OPEN (réouvrir)|
| RESOLVED      | → CLOSED, → IN_PROGRESS      |
| CLOSED        | ❌ aucune (statut terminal)   |

---

## 2. UpdateIncidentStatusRequest.java — DTO

```java
package com.telecom.dao.dto;

import com.telecom.dao.entity.IncidentStatus;
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

    // Commentaire optionnel du technicien
    private String comment;

    // Temporaire jusqu'au JWT
    @NotNull(message = "L'identifiant utilisateur est obligatoire")
    private Long userId;
}
```

---

## 3. InvalidStatusTransitionException.java

```java
package com.telecom.dao.exception;

import com.telecom.dao.entity.IncidentStatus;

public class InvalidStatusTransitionException extends RuntimeException {
    public InvalidStatusTransitionException(IncidentStatus from,
                                             IncidentStatus to) {
        super(String.format(
            "Transition invalide : %s → %s n'est pas autorisée",
            from, to));
    }
}
```

---

## 4. WorkflowValidator.java — règles de transition

```java
package com.telecom.dao.service;

import com.telecom.dao.entity.IncidentStatus;
import com.telecom.dao.exception.InvalidStatusTransitionException;

import java.util.Map;
import java.util.Set;

public class WorkflowValidator {

    // Transitions autorisées
    private static final Map<IncidentStatus, Set<IncidentStatus>> ALLOWED =
        Map.of(
            IncidentStatus.OPEN,        Set.of(IncidentStatus.IN_PROGRESS),
            IncidentStatus.IN_PROGRESS, Set.of(IncidentStatus.RESOLVED,
                                               IncidentStatus.OPEN),
            IncidentStatus.RESOLVED,    Set.of(IncidentStatus.CLOSED,
                                               IncidentStatus.IN_PROGRESS),
            IncidentStatus.CLOSED,      Set.of()  // terminal
        );

    public static void validate(IncidentStatus current,
                                IncidentStatus next) {
        Set<IncidentStatus> allowed = ALLOWED.getOrDefault(current, Set.of());
        if (!allowed.contains(next)) {
            throw new InvalidStatusTransitionException(current, next);
        }
    }
}
```

---

## 5. Service — ajouter updateIncidentStatus()

### Interface

```java
void updateIncidentStatus(Long incidentId, UpdateIncidentStatusRequest request);
```

### Implémentation

```java
@Override
@Transactional
public void updateIncidentStatus(Long incidentId,
                                  UpdateIncidentStatusRequest request) {

    // 1. Récupérer l'incident
    Incident incident = incidentRepository.findById(incidentId)
            .orElseThrow(() -> new IncidentNotFoundException(incidentId));

    // 2. Récupérer le technicien connecté
    User technicien = userRepository.findById(request.getUserId())
            .orElseThrow(() -> new UserNotFoundException(request.getUserId()));

    IncidentStatus oldStatus = incident.getIncidentStatus();
    IncidentStatus newStatus = request.getNewStatus();

    // 3. Contrôle du workflow
    WorkflowValidator.validate(oldStatus, newStatus);

    // 4. Appliquer le nouveau statut
    incident.setIncidentStatus(newStatus);
    incidentRepository.save(incident);

    // 5. Historiser le changement
    //    → oldStatus et newStatus sont remplis ici !
    String comment = request.getComment() != null
            ? request.getComment()
            : String.format("Changement de statut : %s → %s",
                            oldStatus, newStatus);

    IncidentHistory history = new IncidentHistory();
    history.setIncident(incident);
    history.setUser(technicien);
    history.setOldStatus(oldStatus);   // ← REMPLI
    history.setNewStatus(newStatus);   // ← REMPLI
    history.setComment(comment);
    incidentHistoryRepository.save(history);

    log.info("Incident {} : statut {} → {} par user {}",
             incidentId, oldStatus, newStatus, request.getUserId());
}
```

---

## 6. Controller — endpoint PATCH

```java
/**
 * PATCH /api/incidents/{id}/status
 * Rôle : TECHNICIEN
 */
@PatchMapping("/{id}/status")
public ResponseEntity<Void> updateStatus(
        @PathVariable Long id,
        @Valid @RequestBody UpdateIncidentStatusRequest request) {

    incidentService.updateIncidentStatus(id, request);
    return ResponseEntity.ok().build();
}
```

---

## 7. Tests unitaires — Service

```java
package com.telecom.dao.service;

import com.telecom.dao.dto.UpdateIncidentStatusRequest;
import com.telecom.dao.entity.*;
import com.telecom.dao.exception.IncidentNotFoundException;
import com.telecom.dao.exception.InvalidStatusTransitionException;
import com.telecom.dao.repository.*;
import com.telecom.dao.service.impl.IncidentServiceImplementation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Tests — updateIncidentStatus()")
class IncidentStatusServiceTest {

    @Mock private IncidentRepository        incidentRepository;
    @Mock private IncidentHistoryRepository incidentHistoryRepository;
    @Mock private UserRepository            userRepository;

    @InjectMocks
    private IncidentServiceImplementation incidentService;

    private Incident incident;
    private User     technicien;

    @BeforeEach
    void setUp() {
        technicien = new User();
        technicien.setId(5L);
        technicien.setUsername("technicien1");

        incident = new Incident();
        incident.setId(1L);
        incident.setIncidentStatus(IncidentStatus.OPEN);
    }

    // ────────────────────────────────────────────────────────────────────────
    // TRANSITIONS VALIDES
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ OPEN → IN_PROGRESS autorisé")
    void shouldTransition_OpenToInProgress() {
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.IN_PROGRESS, null, 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));
        when(incidentRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        assertThatCode(() -> incidentService.updateIncidentStatus(1L, req))
                .doesNotThrowAnyException();

        ArgumentCaptor<Incident> captor = ArgumentCaptor.forClass(Incident.class);
        verify(incidentRepository).save(captor.capture());
        assertThat(captor.getValue().getIncidentStatus())
                .isEqualTo(IncidentStatus.IN_PROGRESS);
    }

    @Test
    @DisplayName("✅ IN_PROGRESS → RESOLVED autorisé")
    void shouldTransition_InProgressToResolved() {
        incident.setIncidentStatus(IncidentStatus.IN_PROGRESS);
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.RESOLVED, "Problème résolu", 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));
        when(incidentRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        assertThatCode(() -> incidentService.updateIncidentStatus(1L, req))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("✅ IN_PROGRESS → OPEN autorisé (réouverture)")
    void shouldTransition_InProgressToOpen() {
        incident.setIncidentStatus(IncidentStatus.IN_PROGRESS);
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.OPEN, "Réouverture", 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));
        when(incidentRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        assertThatCode(() -> incidentService.updateIncidentStatus(1L, req))
                .doesNotThrowAnyException();
    }

    // ────────────────────────────────────────────────────────────────────────
    // HISTORISATION
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ oldStatus et newStatus remplis dans l'historique")
    void shouldSaveHistory_WithOldAndNewStatus() {
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.IN_PROGRESS,
                                            "Prise en charge", 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));
        when(incidentRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        incidentService.updateIncidentStatus(1L, req);

        ArgumentCaptor<IncidentHistory> histCaptor =
                ArgumentCaptor.forClass(IncidentHistory.class);
        verify(incidentHistoryRepository).save(histCaptor.capture());

        IncidentHistory saved = histCaptor.getValue();
        assertThat(saved.getOldStatus()).isEqualTo(IncidentStatus.OPEN);
        assertThat(saved.getNewStatus()).isEqualTo(IncidentStatus.IN_PROGRESS);
        assertThat(saved.getComment()).isEqualTo("Prise en charge");
        assertThat(saved.getUser()).isEqualTo(technicien);
    }

    @Test
    @DisplayName("✅ Commentaire auto si pas fourni")
    void shouldGenerateComment_whenNull() {
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.IN_PROGRESS, null, 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));
        when(incidentRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        incidentService.updateIncidentStatus(1L, req);

        ArgumentCaptor<IncidentHistory> captor =
                ArgumentCaptor.forClass(IncidentHistory.class);
        verify(incidentHistoryRepository).save(captor.capture());
        assertThat(captor.getValue().getComment())
                .contains("OPEN")
                .contains("IN_PROGRESS");
    }

    // ────────────────────────────────────────────────────────────────────────
    // TRANSITIONS INVALIDES — contrôle du workflow
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("❌ OPEN → RESOLVED interdit")
    void shouldThrow_OpenToResolved() {
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.RESOLVED, null, 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));

        assertThatThrownBy(() -> incidentService.updateIncidentStatus(1L, req))
                .isInstanceOf(InvalidStatusTransitionException.class)
                .hasMessageContaining("OPEN")
                .hasMessageContaining("RESOLVED");

        verify(incidentRepository, never()).save(any());
        verify(incidentHistoryRepository, never()).save(any());
    }

    @Test
    @DisplayName("❌ OPEN → CLOSED interdit")
    void shouldThrow_OpenToClosed() {
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.CLOSED, null, 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));

        assertThatThrownBy(() -> incidentService.updateIncidentStatus(1L, req))
                .isInstanceOf(InvalidStatusTransitionException.class);
    }

    @Test
    @DisplayName("❌ CLOSED → tout statut interdit (terminal)")
    void shouldThrow_FromClosed() {
        incident.setIncidentStatus(IncidentStatus.CLOSED);
        UpdateIncidentStatusRequest req =
            new UpdateIncidentStatusRequest(IncidentStatus.OPEN, null, 5L);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findById(5L)).thenReturn(Optional.of(technicien));

        assertThatThrownBy(() -> incidentService.updateIncidentStatus(1L, req))
                .isInstanceOf(InvalidStatusTransitionException.class)
                .hasMessageContaining("CLOSED");
    }

    @Test
    @DisplayName("❌ Incident introuvable → 404")
    void shouldThrow_whenIncidentNotFound() {
        when(incidentRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> incidentService.updateIncidentStatus(99L,
                new UpdateIncidentStatusRequest(IncidentStatus.IN_PROGRESS, null, 5L)))
                .isInstanceOf(IncidentNotFoundException.class);
    }
}
```

---

## 8. Test Postman — scénario complet

```
# Étape 1 — Changer statut OPEN → IN_PROGRESS
PATCH /api/incidents/1/status
{
  "newStatus": "IN_PROGRESS",
  "comment": "Prise en charge",
  "userId": 3
}
→ 200 OK

# Étape 2 — Changer statut IN_PROGRESS → RESOLVED
PATCH /api/incidents/1/status
{
  "newStatus": "RESOLVED",
  "comment": "Problème résolu",
  "userId": 3
}
→ 200 OK

# Étape 3 — Voir l'historique complet
GET /api/incidents/1/history
→ oldStatus/newStatus maintenant REMPLIS ✅

# Étape 4 — Tester transition invalide
PATCH /api/incidents/1/status
{
  "newStatus": "OPEN",
  "userId": 3
}
→ 409 Conflict — "Transition invalide : RESOLVED → OPEN n'est pas autorisée"
```

---

## GlobalExceptionHandler — ajouter

```java
@ExceptionHandler(InvalidStatusTransitionException.class)
public ResponseEntity<String> handleInvalidTransition(
        InvalidStatusTransitionException ex) {
    return ResponseEntity.status(HttpStatus.CONFLICT).body(ex.getMessage());
}
```
