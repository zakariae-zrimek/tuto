# US-010 — Consultation Historique d'un incident

## Ce qu'on a déjà ✅ vs ce qu'il faut compléter 🔧

| Élément | Statut |
|---------|--------|
| `IncidentHistoryResponse.java` | ✅ déjà fait |
| `IncidentHistoryRepository` | ✅ déjà fait |
| `getIncidentHistory()` service | ✅ déjà fait |
| `GET /api/incidents/{id}/history` | ✅ déjà fait |
| Ordre chronologique (ancien → récent) | 🔧 à ajuster |
| Affichage utilisateur + date dans DTO | 🔧 à enrichir |
| Tests unitaires complets | 🔧 à faire |

---

## 1. IncidentHistoryResponse.java — DTO enrichi

```java
package com.telecom.dao.dto;

import com.telecom.dao.entity.IncidentStatus;
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
public class IncidentHistoryResponse {

    private Long           id;

    // Affichage chronologique → numéro de l'action
    private Integer        actionNumber;

    // Changement de statut
    private IncidentStatus oldStatus;
    private IncidentStatus newStatus;

    // Description de l'action (qualification, changement statut...)
    private String         comment;

    // Affichage utilisateur et date (critères d'acceptation)
    private String         modifiedBy;        // username
    private String         modifiedByFullName; // prénom + nom

    @JsonFormat(pattern = "dd/MM/yyyy HH:mm:ss")
    private LocalDateTime  modificationDate;
}
```

---

## 2. IncidentHistoryRepository.java — ordre chronologique

```java
package com.telecom.dao.repository;

import com.telecom.dao.entity.IncidentHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface IncidentHistoryRepository
        extends JpaRepository<IncidentHistory, Long> {

    // Ordre chronologique : du plus ancien au plus récent (ASC)
    List<IncidentHistory> findByIncidentIdOrderByModificationDateAsc(Long incidentId);
}
```

---

## 3. IncidentService.java — interface

```java
// Ajouter dans l'interface :
List<IncidentHistoryResponse> getIncidentHistory(Long incidentId);
```

---

## 4. IncidentServiceImplementation.java — méthode complète

```java
@Override
@Transactional(readOnly = true)
public List<IncidentHistoryResponse> getIncidentHistory(Long incidentId) {

    // Vérifier que l'incident existe
    if (!incidentRepository.existsById(incidentId)) {
        throw new IncidentNotFoundException(incidentId);
    }

    List<IncidentHistory> histories = incidentHistoryRepository
            .findByIncidentIdOrderByModificationDateAsc(incidentId);

    // Numéroter les actions dans l'ordre chronologique
    AtomicInteger counter = new AtomicInteger(1);

    return histories.stream()
            .map(h -> IncidentHistoryResponse.builder()
                    .id(h.getId())
                    .actionNumber(counter.getAndIncrement())
                    .oldStatus(h.getOldStatus())
                    .newStatus(h.getNewStatus())
                    .comment(h.getComment())
                    .modifiedBy(h.getUser().getUsername())
                    .modifiedByFullName(
                        h.getUser().getFirstName() + " " + h.getUser().getLastName()
                    )
                    .modificationDate(h.getModificationDate())
                    .build())
            .toList();
}
```

---

## 5. IncidentController.java — endpoint

```java
/**
 * GET /api/incidents/{id}/history
 * US-010 — Consultation historique
 * Accessible par tout utilisateur authentifié
 */
@GetMapping("/{id}/history")
public ResponseEntity<List<IncidentHistoryResponse>> getHistory(
        @PathVariable Long id) {

    List<IncidentHistoryResponse> history =
            incidentService.getIncidentHistory(id);

    return ResponseEntity.ok(history);
}
```

---

## 6. Tests unitaires — Service

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
@DisplayName("US-010 — Tests getIncidentHistory()")
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
        responsable.setFirstName("Jean");
        responsable.setLastName("Dupont");

        incident = new Incident();
        incident.setId(1L);
        incident.setTitle("Panne réseau");
    }

    // ── Helper ──────────────────────────────────────────────────────────────

    private IncidentHistory buildHistory(Long id, String comment,
                                         LocalDateTime date,
                                         IncidentStatus oldSt,
                                         IncidentStatus newSt) {
        IncidentHistory h = new IncidentHistory();
        h.setId(id);
        h.setIncident(incident);
        h.setUser(responsable);
        h.setOldStatus(oldSt);
        h.setNewStatus(newSt);
        h.setComment(comment);
        h.setModificationDate(date);
        return h;
    }

    // ────────────────────────────────────────────────────────────────────────
    // CAS NOMINAUX
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ Consultation complète — retourne toutes les entrées")
    void shouldReturnCompleteHistory() {
        LocalDateTime t1 = LocalDateTime.of(2026, 9, 3, 9, 0);
        LocalDateTime t2 = LocalDateTime.of(2026, 9, 3, 10, 0);
        LocalDateTime t3 = LocalDateTime.of(2026, 9, 3, 11, 0);

        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateAsc(1L))
                .thenReturn(List.of(
                    buildHistory(1L,
                        "Qualification — Type : HARDWARE → NETWORK | Priorité : LOW → HIGH",
                        t1, null, null),
                    buildHistory(2L,
                        "Qualification — Type : NETWORK → SOFTWARE | Priorité : HIGH → CRITICAL",
                        t2, null, null),
                    buildHistory(3L,
                        "Changement statut",
                        t3, IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS)
                ));

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        // Consultation complète : 3 entrées
        assertThat(result).hasSize(3);
    }

    @Test
    @DisplayName("✅ Affichage chronologique — du plus ancien au plus récent")
    void shouldBeInChronologicalOrder() {
        LocalDateTime t1 = LocalDateTime.of(2026, 9, 3, 9, 0);
        LocalDateTime t2 = LocalDateTime.of(2026, 9, 3, 10, 0);

        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateAsc(1L))
                .thenReturn(List.of(
                    buildHistory(1L, "1er action", t1, null, null),
                    buildHistory(2L, "2ème action", t2, null, null)
                ));

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        // Plus ancien en premier
        assertThat(result.get(0).getModificationDate()).isEqualTo(t1);
        assertThat(result.get(1).getModificationDate()).isEqualTo(t2);

        // Numérotation chronologique
        assertThat(result.get(0).getActionNumber()).isEqualTo(1);
        assertThat(result.get(1).getActionNumber()).isEqualTo(2);
    }

    @Test
    @DisplayName("✅ Affichage utilisateur — username et nom complet présents")
    void shouldDisplayUserInfo() {
        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateAsc(1L))
                .thenReturn(List.of(
                    buildHistory(1L, "Action", LocalDateTime.now(), null, null)
                ));

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        assertThat(result.get(0).getModifiedBy()).isEqualTo("responsable1");
        assertThat(result.get(0).getModifiedByFullName()).isEqualTo("Jean Dupont");
    }

    @Test
    @DisplayName("✅ Affichage date — modificationDate non nulle")
    void shouldDisplayDate() {
        LocalDateTime now = LocalDateTime.now();

        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateAsc(1L))
                .thenReturn(List.of(
                    buildHistory(1L, "Action", now, null, null)
                ));

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        assertThat(result.get(0).getModificationDate()).isEqualTo(now);
    }

    @Test
    @DisplayName("✅ Retourne liste vide si aucun historique")
    void shouldReturnEmptyList_whenNoHistory() {
        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateAsc(1L))
                .thenReturn(List.of());

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        assertThat(result).isEmpty();
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
                .findByIncidentIdOrderByModificationDateAsc(any());
    }

    // ────────────────────────────────────────────────────────────────────────
    // VÉRIFICATION DES CRITÈRES D'ACCEPTATION
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ Critères d'acceptation — consultation complète + chrono + user + date")
    void shouldMeetAllAcceptanceCriteria() {
        LocalDateTime t1 = LocalDateTime.of(2026, 9, 3, 9, 0);
        LocalDateTime t2 = LocalDateTime.of(2026, 9, 3, 10, 0);

        when(incidentRepository.existsById(1L)).thenReturn(true);
        when(incidentHistoryRepository
                .findByIncidentIdOrderByModificationDateAsc(1L))
                .thenReturn(List.of(
                    buildHistory(1L,
                        "Qualification — Type : HARDWARE → NETWORK | Priorité : LOW → HIGH",
                        t1, null, null),
                    buildHistory(2L,
                        "Changement statut",
                        t2, IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS)
                ));

        List<IncidentHistoryResponse> result =
                incidentService.getIncidentHistory(1L);

        // ✅ Consultation complète
        assertThat(result).hasSize(2);
        assertThat(result).allSatisfy(h -> {
            assertThat(h.getId()).isNotNull();
            assertThat(h.getComment()).isNotNull();
        });

        // ✅ Affichage chronologique
        assertThat(result.get(0).getActionNumber()).isEqualTo(1);
        assertThat(result.get(1).getActionNumber()).isEqualTo(2);
        assertThat(result.get(0).getModificationDate())
                .isBefore(result.get(1).getModificationDate());

        // ✅ Affichage utilisateur et date
        assertThat(result).allSatisfy(h -> {
            assertThat(h.getModifiedBy()).isNotBlank();
            assertThat(h.getModifiedByFullName()).isNotBlank();
            assertThat(h.getModificationDate()).isNotNull();
        });
    }
}
```

---

## Réponse Postman attendue

```json
GET /api/incidents/1/history

[
  {
    "id": 1,
    "actionNumber": 1,
    "oldStatus": null,
    "newStatus": null,
    "comment": "Qualification — Type : HARDWARE → NETWORK | Priorité : LOW → HIGH",
    "modifiedBy": "responsable1",
    "modifiedByFullName": "Jean Dupont",
    "modificationDate": "03/09/2026 09:00:00"
  },
  {
    "id": 2,
    "actionNumber": 2,
    "oldStatus": null,
    "newStatus": null,
    "comment": "Qualification — Type : NETWORK → SOFTWARE | Priorité : HIGH → CRITICAL",
    "modifiedBy": "responsable1",
    "modifiedByFullName": "Jean Dupont",
    "modificationDate": "03/09/2026 10:00:00"
  },
  {
    "id": 3,
    "actionNumber": 3,
    "oldStatus": "OPEN",
    "newStatus": "IN_PROGRESS",
    "comment": "Incident pris en charge",
    "modifiedBy": "responsable1",
    "modifiedByFullName": "Jean Dupont",
    "modificationDate": "03/09/2026 11:00:00"
  }
]
```
