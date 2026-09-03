# Historique d'un incident — Implémentation complète

## Ce qu'on va faire

```
PATCH /api/incidents/1/qualify   ← 1er changement
PATCH /api/incidents/1/qualify   ← 2ème changement
GET   /api/incidents/1/history   ← voir les 2 entrées
```

---

## 1. IncidentHistoryResponse.java — DTO de réponse

```java
package com.telecom.dao.dto;

import com.telecom.dao.entity.IncidentStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IncidentHistoryResponse {

    private Long            id;
    private IncidentStatus  oldStatus;
    private IncidentStatus  newStatus;
    private String          comment;
    private LocalDateTime   modificationDate;
    private String          modifiedBy;   // username du User
}
```

---

## 2. IncidentHistoryRepository.java

```java
package com.telecom.dao.repository;

import com.telecom.dao.entity.IncidentHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface IncidentHistoryRepository
        extends JpaRepository<IncidentHistory, Long> {

    // Toutes les entrées d'un incident, triées de la plus récente à la plus ancienne
    List<IncidentHistory> findByIncidentIdOrderByModificationDateDesc(Long incidentId);
}
```

---

## 3. Service — ajouter getIncidentHistory()

```java
// Dans IncidentService.java (interface), ajouter :
List<IncidentHistoryResponse> getIncidentHistory(Long incidentId);
```

```java
// Dans IncidentServiceImplementation.java, ajouter :

@Override
@Transactional(readOnly = true)
public List<IncidentHistoryResponse> getIncidentHistory(Long incidentId) {

    // Vérifier que l'incident existe
    if (!incidentRepository.existsById(incidentId)) {
        throw new IncidentNotFoundException(incidentId);
    }

    return incidentHistoryRepository
            .findByIncidentIdOrderByModificationDateDesc(incidentId)
            .stream()
            .map(h -> IncidentHistoryResponse.builder()
                    .id(h.getId())
                    .oldStatus(h.getOldStatus())
                    .newStatus(h.getNewStatus())
                    .comment(h.getComment())
                    .modificationDate(h.getModificationDate())
                    .modifiedBy(h.getUser().getUsername())
                    .build())
            .toList();
}
```

---

## 4. Controller — ajouter GET /history

```java
/**
 * GET /api/incidents/{id}/history
 * Accessible par : RESPONSABLE, ADMIN (adapter selon tes rôles)
 */
@GetMapping("/{id}/history")
@PreAuthorize("hasAnyRole('RESPONSABLE', 'ADMIN')")
public ResponseEntity<List<IncidentHistoryResponse>> getHistory(
        @PathVariable Long id) {

    return ResponseEntity.ok(incidentService.getIncidentHistory(id));
}
```

---

## 5. Tests unitaires — Service (getIncidentHistory)

```java
package com.telecom.dao.service;

import com.telecom.dao.dto.IncidentHistoryResponse;
import com.telecom.dao.entity.*;
import com.telecom.dao.exception.IncidentNotFoundException;
import com.telecom.dao.repository.IncidentHistoryRepository;
import com.telecom.dao.repository.IncidentRepository;
import com.telecom.dao.repository.UserRepository;
import com.telecom.dao.service.impl.IncidentServiceImplementation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Tests unitaires — getIncidentHistory()")
class IncidentHistoryServiceTest {

    @Mock private IncidentRepository        incidentRepository;
    @Mock private IncidentHistoryRepository incidentHistoryRepository;
    @Mock private UserRepository            userRepository;

    @InjectMocks
    private IncidentServiceImplementation incidentService;

    private Incident incident;
    private User     responsable;

    @BeforeEach
    void setUp() {
        responsable = new User();
        responsable.setId(10L);
        responsable.setUsername("responsable1");

        incident = new Incident();
        incident.setId(1L);
        incident.setTitle("Panne réseau");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private IncidentHistory makeHistory(Long id, String comment,
                                        LocalDateTime date) {
        IncidentHistory h = new IncidentHistory();
        h.setId(id);
        h.setIncident(incident);
        h.setUser(responsable);
        h.setOldStatus(null);
        h.setNewStatus(null);
        h.setComment(comment);
        h.setModificationDate(date);
        return h;
    }

    // ────────────────────────────────────────────────────────────────────────
    // CAS NOMINAUX
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ Retourne 2 entrées après 2 qualifications")
    void shouldReturnTwoHistoryEntries() {
        LocalDateTime t1 = LocalDateTime.of(2026, 9, 3, 10, 0);
        LocalDateTime t2 = LocalDateTime.of(2026, 9, 3, 11, 0);

        // findByIncidentIdOrderByModificationDateDesc → plus récent en premier
        List<IncidentHistory> histories = List.of(
            makeHistory(2L,
                "Qualification — Type : NETWORK → SOFTWARE | Priorité : HIGH → CRITICAL",
                t2),
            makeHistory(1L,
                "Qualification — Type : HARDWARE → NETWORK | Priorité : LOW → HIGH",
                t1)
        );

        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateDesc(1L))
                .thenReturn(histories);

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        // 2 entrées retournées
        assertThat(result).hasSize(2);

        // La plus récente en premier
        assertThat(result.get(0).getId()).isEqualTo(2L);
        assertThat(result.get(0).getComment()).contains("SOFTWARE").contains("CRITICAL");
        assertThat(result.get(0).getModificationDate()).isEqualTo(t2);
        assertThat(result.get(0).getModifiedBy()).isEqualTo("responsable1");

        // La plus ancienne en second
        assertThat(result.get(1).getId()).isEqualTo(1L);
        assertThat(result.get(1).getComment()).contains("NETWORK").contains("HIGH");
        assertThat(result.get(1).getModificationDate()).isEqualTo(t1);
    }

    @Test
    @DisplayName("✅ Retourne liste vide si aucun historique")
    void shouldReturnEmptyList_whenNoHistory() {
        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateDesc(1L))
                .thenReturn(List.of());

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("✅ Le DTO contient bien modifiedBy (username)")
    void shouldMapModifiedByCorrectly() {
        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateDesc(1L))
                .thenReturn(List.of(
                    makeHistory(1L, "Qualification test",
                        LocalDateTime.now())
                ));

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        assertThat(result.get(0).getModifiedBy()).isEqualTo("responsable1");
    }

    // ────────────────────────────────────────────────────────────────────────
    // CAS D'ERREUR
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("❌ Lève IncidentNotFoundException si incident inconnu")
    void shouldThrow_whenIncidentNotFound() {
        when(incidentRepository.existsById(99L)).thenReturn(false);

        assertThatThrownBy(() -> incidentService.getIncidentHistory(99L))
                .isInstanceOf(IncidentNotFoundException.class)
                .hasMessageContaining("99");

        verify(incidentHistoryRepository, never())
                .findByIncidentIdOrderByModificationDateDesc(any());
    }
}
```

---

## 6. Scénario de test complet — ce que tu vas voir

### Étape 1 — 1er appel PATCH

```json
PATCH /api/incidents/1/qualify
{
  "incidentType": "NETWORK",
  "priority": "HIGH"
}
→ 200 OK
```

### Étape 2 — 2ème appel PATCH

```json
PATCH /api/incidents/1/qualify
{
  "incidentType": "SOFTWARE",
  "priority": "CRITICAL"
}
→ 200 OK
```

### Étape 3 — GET /history

```json
GET /api/incidents/1/history
→ 200 OK

[
  {
    "id": 2,
    "oldStatus": null,
    "newStatus": null,
    "comment": "Qualification — Type : NETWORK → SOFTWARE | Priorité : HIGH → CRITICAL",
    "modificationDate": "2026-09-03T11:00:00",
    "modifiedBy": "responsable1"
  },
  {
    "id": 1,
    "oldStatus": null,
    "newStatus": null,
    "comment": "Qualification — Type : HARDWARE → NETWORK | Priorité : LOW → HIGH",
    "modificationDate": "2026-09-03T10:00:00",
    "modifiedBy": "responsable1"
  }
]
```

→ **2 entrées, triées de la plus récente à la plus ancienne.**
→ On voit la chaîne complète : HARDWARE → NETWORK → SOFTWARE
