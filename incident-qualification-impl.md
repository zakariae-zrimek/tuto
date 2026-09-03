# Implémentation US-007 — Modifier le type et la priorité d'un incident

## Structure des fichiers à créer / modifier

```
src/
├── main/java/
│   ├── dto/
│   │   └── UpdateIncidentQualificationRequest.java
│   ├── exception/
│   │   ├── IncidentNotFoundException.java
│   │   └── InvalidIncidentStateException.java
│   ├── service/
│   │   └── IncidentService.java          ← ajouter la méthode
│   │   └── impl/IncidentServiceImpl.java ← implémenter
│   └── controller/
│       └── IncidentController.java       ← ajouter l'endpoint
└── test/java/
    └── service/
        └── IncidentServiceQualifyTest.java
    └── controller/
        └── IncidentControllerQualifyTest.java
```

---

## 1. DTO — UpdateIncidentQualificationRequest.java

```java
package com.yourpackage.dto;

import com.yourpackage.entity.IncidentType;
import com.yourpackage.entity.Priority;
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
}
```

---

## 2. Exceptions métier

### IncidentNotFoundException.java

```java
package com.yourpackage.exception;

public class IncidentNotFoundException extends RuntimeException {
    public IncidentNotFoundException(Long id) {
        super("Incident introuvable avec l'id : " + id);
    }
}
```

### InvalidIncidentStateException.java

```java
package com.yourpackage.exception;

public class InvalidIncidentStateException extends RuntimeException {
    public InvalidIncidentStateException(String message) {
        super(message);
    }
}
```

---

## 3. Service — interface (ajouter la méthode)

```java
// Dans IncidentService.java, ajouter :
void qualifyIncident(Long incidentId, UpdateIncidentQualificationRequest request);
```

---

## 4. Service — Implémentation

```java
package com.yourpackage.service.impl;

import com.yourpackage.dto.UpdateIncidentQualificationRequest;
import com.yourpackage.entity.Incident;
import com.yourpackage.entity.IncidentHistory;
import com.yourpackage.entity.IncidentStatus;
import com.yourpackage.exception.IncidentNotFoundException;
import com.yourpackage.exception.InvalidIncidentStateException;
import com.yourpackage.repository.IncidentRepository;
import com.yourpackage.repository.IncidentHistoryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Slf4j
@Service
@RequiredArgsConstructor
public class IncidentServiceImpl implements IncidentService {

    private final IncidentRepository incidentRepository;
    private final IncidentHistoryRepository incidentHistoryRepository;

    // ── Statuts terminaux : on ne peut plus qualifier un incident clôturé ──
    private static final Set<IncidentStatus> TERMINAL_STATUSES = Set.of(
            IncidentStatus.RESOLVED,
            IncidentStatus.CLOSED
    );

    @Override
    @Transactional
    public void qualifyIncident(Long incidentId,
                                UpdateIncidentQualificationRequest request) {

        // 1. Récupérer l'incident
        Incident incident = incidentRepository.findById(incidentId)
                .orElseThrow(() -> new IncidentNotFoundException(incidentId));

        // 2. Validation métier : statut terminal ?
        if (TERMINAL_STATUSES.contains(incident.getIncidentStatus())) {
            throw new InvalidIncidentStateException(
                    "Impossible de qualifier un incident au statut : "
                    + incident.getIncidentStatus());
        }

        // 3. Sauvegarder les anciennes valeurs pour l'historique
        String oldType     = incident.getIncidentType() != null
                             ? incident.getIncidentType().name() : "N/A";
        String oldPriority = incident.getPriority() != null
                             ? incident.getPriority().name() : "N/A";

        // 4. Appliquer les modifications
        incident.setIncidentType(request.getIncidentType());
        incident.setPriority(request.getPriority());

        incidentRepository.save(incident);

        // 5. Tracer dans l'historique
        IncidentHistory history = IncidentHistory.builder()
                .incident(incident)
                .changedAt(LocalDateTime.now())
                .changeDescription(String.format(
                        "Qualification modifiée — Type : %s → %s | Priorité : %s → %s",
                        oldType,     request.getIncidentType().name(),
                        oldPriority, request.getPriority().name()))
                .build();

        incidentHistoryRepository.save(history);

        log.info("Incident {} qualifié → type={} priorité={}",
                incidentId, request.getIncidentType(), request.getPriority());
    }
}
```

---

## 5. Controller — endpoint PATCH

```java
package com.yourpackage.controller;

import com.yourpackage.dto.UpdateIncidentQualificationRequest;
import com.yourpackage.service.IncidentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/incidents")
@RequiredArgsConstructor
public class IncidentController {

    private final IncidentService incidentService;

    /**
     * PATCH /api/incidents/{id}/qualify
     * Rôle requis : RESPONSABLE
     */
    @PatchMapping("/{id}/qualify")
    @PreAuthorize("hasRole('RESPONSABLE')")
    public ResponseEntity<Void> qualifyIncident(
            @PathVariable Long id,
            @Valid @RequestBody UpdateIncidentQualificationRequest request) {

        incidentService.qualifyIncident(id, request);
        return ResponseEntity.ok().build();
    }
}
```

---

## 6. Tests unitaires — Service

```java
package com.yourpackage.service;

import com.yourpackage.dto.UpdateIncidentQualificationRequest;
import com.yourpackage.entity.*;
import com.yourpackage.exception.IncidentNotFoundException;
import com.yourpackage.exception.InvalidIncidentStateException;
import com.yourpackage.repository.IncidentHistoryRepository;
import com.yourpackage.repository.IncidentRepository;
import com.yourpackage.service.impl.IncidentServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Tests unitaires — qualifyIncident()")
class IncidentServiceQualifyTest {

    @Mock
    private IncidentRepository incidentRepository;

    @Mock
    private IncidentHistoryRepository incidentHistoryRepository;

    @InjectMocks
    private IncidentServiceImpl incidentService;

    private Incident incident;
    private UpdateIncidentQualificationRequest request;

    @BeforeEach
    void setUp() {
        incident = new Incident();
        incident.setId(1L);
        incident.setTitle("Panne réseau");
        incident.setIncidentStatus(IncidentStatus.OPEN);
        incident.setIncidentType(IncidentType.HARDWARE);
        incident.setPriority(Priority.LOW);

        request = new UpdateIncidentQualificationRequest(
                IncidentType.NETWORK,
                Priority.HIGH
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // CAS NOMINAL
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ Doit mettre à jour le type et la priorité")
    void shouldUpdateTypeAndPriority() {
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        incidentService.qualifyIncident(1L, request);

        ArgumentCaptor<Incident> captor = ArgumentCaptor.forClass(Incident.class);
        verify(incidentRepository).save(captor.capture());

        Incident saved = captor.getValue();
        assertThat(saved.getIncidentType()).isEqualTo(IncidentType.NETWORK);
        assertThat(saved.getPriority()).isEqualTo(Priority.HIGH);
    }

    @Test
    @DisplayName("✅ Doit enregistrer une entrée dans l'historique")
    void shouldSaveHistory() {
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        incidentService.qualifyIncident(1L, request);

        ArgumentCaptor<IncidentHistory> historyCaptor =
                ArgumentCaptor.forClass(IncidentHistory.class);
        verify(incidentHistoryRepository).save(historyCaptor.capture());

        IncidentHistory history = historyCaptor.getValue();
        assertThat(history.getChangeDescription())
                .contains("HARDWARE")   // ancienne valeur
                .contains("NETWORK")    // nouvelle valeur
                .contains("LOW")        // ancienne priorité
                .contains("HIGH");      // nouvelle priorité
        assertThat(history.getChangedAt()).isNotNull();
    }

    @Test
    @DisplayName("✅ Doit fonctionner avec tous les types d'incident valides")
    @ParameterizedTest
    @EnumSource(IncidentType.class)
    void shouldAcceptAllIncidentTypes(IncidentType type) {
        request.setIncidentType(type);
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        assertThatCode(() -> incidentService.qualifyIncident(1L, request))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("✅ Doit fonctionner avec toutes les priorités valides")
    @ParameterizedTest
    @EnumSource(Priority.class)
    void shouldAcceptAllPriorities(Priority priority) {
        request.setPriority(priority);
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        assertThatCode(() -> incidentService.qualifyIncident(1L, request))
                .doesNotThrowAnyException();
    }

    // ────────────────────────────────────────────────────────────────────────
    // CAS D'ERREUR
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("❌ Doit lever IncidentNotFoundException si l'incident n'existe pas")
    void shouldThrow_whenIncidentNotFound() {
        when(incidentRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> incidentService.qualifyIncident(99L, request))
                .isInstanceOf(IncidentNotFoundException.class)
                .hasMessageContaining("99");

        verify(incidentRepository, never()).save(any());
        verify(incidentHistoryRepository, never()).save(any());
    }

    @Test
    @DisplayName("❌ Doit lever InvalidIncidentStateException si statut RESOLVED")
    void shouldThrow_whenStatusIsResolved() {
        incident.setIncidentStatus(IncidentStatus.RESOLVED);
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));

        assertThatThrownBy(() -> incidentService.qualifyIncident(1L, request))
                .isInstanceOf(InvalidIncidentStateException.class)
                .hasMessageContaining("RESOLVED");

        verify(incidentRepository, never()).save(any());
    }

    @Test
    @DisplayName("❌ Doit lever InvalidIncidentStateException si statut CLOSED")
    void shouldThrow_whenStatusIsClosed() {
        incident.setIncidentStatus(IncidentStatus.CLOSED);
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));

        assertThatThrownBy(() -> incidentService.qualifyIncident(1L, request))
                .isInstanceOf(InvalidIncidentStateException.class)
                .hasMessageContaining("CLOSED");
    }
}
```

---

## 7. Tests unitaires — Controller

```java
package com.yourpackage.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourpackage.dto.UpdateIncidentQualificationRequest;
import com.yourpackage.entity.IncidentType;
import com.yourpackage.entity.Priority;
import com.yourpackage.exception.IncidentNotFoundException;
import com.yourpackage.exception.InvalidIncidentStateException;
import com.yourpackage.service.IncidentService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(IncidentController.class)
@DisplayName("Tests Controller — PATCH /api/incidents/{id}/qualify")
class IncidentControllerQualifyTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private IncidentService incidentService;

    private final UpdateIncidentQualificationRequest validRequest =
            new UpdateIncidentQualificationRequest(IncidentType.NETWORK, Priority.HIGH);

    // ────────────────────────────────────────────────────────────────────────
    // SÉCURITÉ
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ 200 OK — Rôle RESPONSABLE")
    @WithMockUser(roles = "RESPONSABLE")
    void shouldReturn200_whenResponsable() throws Exception {
        doNothing().when(incidentService).qualifyIncident(eq(1L), any());

        mockMvc.perform(patch("/api/incidents/1/qualify")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(validRequest)))
                .andExpect(status().isOk());

        verify(incidentService).qualifyIncident(eq(1L), any());
    }

    @Test
    @DisplayName("❌ 403 Forbidden — Rôle USER simple")
    @WithMockUser(roles = "USER")
    void shouldReturn403_whenNotResponsable() throws Exception {
        mockMvc.perform(patch("/api/incidents/1/qualify")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(validRequest)))
                .andExpect(status().isForbidden());

        verify(incidentService, never()).qualifyIncident(any(), any());
    }

    @Test
    @DisplayName("❌ 401 Unauthorized — Non authentifié")
    void shouldReturn401_whenNotAuthenticated() throws Exception {
        mockMvc.perform(patch("/api/incidents/1/qualify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(validRequest)))
                .andExpect(status().isUnauthorized());
    }

    // ────────────────────────────────────────────────────────────────────────
    // VALIDATION
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("❌ 400 Bad Request — type null")
    @WithMockUser(roles = "RESPONSABLE")
    void shouldReturn400_whenTypeIsNull() throws Exception {
        UpdateIncidentQualificationRequest bad =
                new UpdateIncidentQualificationRequest(null, Priority.HIGH);

        mockMvc.perform(patch("/api/incidents/1/qualify")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(bad)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("❌ 400 Bad Request — priority null")
    @WithMockUser(roles = "RESPONSABLE")
    void shouldReturn400_whenPriorityIsNull() throws Exception {
        UpdateIncidentQualificationRequest bad =
                new UpdateIncidentQualificationRequest(IncidentType.NETWORK, null);

        mockMvc.perform(patch("/api/incidents/1/qualify")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(bad)))
                .andExpect(status().isBadRequest());
    }

    // ────────────────────────────────────────────────────────────────────────
    // CAS D'ERREUR MÉTIER
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("❌ 404 Not Found — incident inexistant")
    @WithMockUser(roles = "RESPONSABLE")
    void shouldReturn404_whenIncidentNotFound() throws Exception {
        doThrow(new IncidentNotFoundException(99L))
                .when(incidentService).qualifyIncident(eq(99L), any());

        mockMvc.perform(patch("/api/incidents/99/qualify")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(validRequest)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("❌ 409 Conflict — incident en statut terminal")
    @WithMockUser(roles = "RESPONSABLE")
    void shouldReturn409_whenInvalidState() throws Exception {
        doThrow(new InvalidIncidentStateException("RESOLVED"))
                .when(incidentService).qualifyIncident(eq(1L), any());

        mockMvc.perform(patch("/api/incidents/1/qualify")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(validRequest)))
                .andExpect(status().isConflict());
    }
}
```

---

## 8. Global Exception Handler (si pas déjà présent)

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(IncidentNotFoundException.class)
    public ResponseEntity<String> handleNotFound(IncidentNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ex.getMessage());
    }

    @ExceptionHandler(InvalidIncidentStateException.class)
    public ResponseEntity<String> handleInvalidState(InvalidIncidentStateException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> handleValidation(
            MethodArgumentNotValidException ex) {
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getFieldErrors()
          .forEach(e -> errors.put(e.getField(), e.getDefaultMessage()));
        return ResponseEntity.badRequest().body(errors);
    }
}
```

---

## Résumé de l'API

| Méthode | URL | Rôle | Body |
|---------|-----|------|------|
| PATCH | `/api/incidents/{id}/qualify` | RESPONSABLE | `{ "incidentType": "NETWORK", "priority": "HIGH" }` |

### Codes retour

| Code | Situation |
|------|-----------|
| 200 | Qualification appliquée avec succès |
| 400 | Champs manquants ou invalides |
| 401 | Non authentifié |
| 403 | Rôle insuffisant |
| 404 | Incident introuvable |
| 409 | Incident dans un état terminal (RESOLVED/CLOSED) |
