# Correction — IncidentServiceImpl adapté à la vraie entité IncidentHistory

## Entité réelle IncidentHistory (ce que tu as)

| Champ            | Type             | Nullable |
|------------------|------------------|----------|
| id               | Long             | NON      |
| oldStatus        | IncidentStatus   | OUI      |
| newStatus        | IncidentStatus   | OUI      |
| comment          | String           | OUI      |
| modificationDate | LocalDateTime    | NON (@UpdateTimestamp) |
| user             | User             | NON      |
| incident         | Incident         | NON      |

→ Pas de champ `changeDescription` ni `changedAt`.
→ On utilisera `comment` pour décrire la qualification.
→ `user` est obligatoire → on le récupère depuis Spring Security.

---

## IncidentServiceImpl.java — version corrigée

```java
package com.telecom.dao.service.impl;

import com.telecom.dao.entity.*;
import com.telecom.dao.repository.IncidentHistoryRepository;
import com.telecom.dao.repository.IncidentRepository;
import com.telecom.dao.repository.UserRepository;
import com.telecom.dao.dto.UpdateIncidentQualificationRequest;
import com.telecom.dao.exception.IncidentNotFoundException;
import com.telecom.dao.exception.InvalidIncidentStateException;
import com.telecom.dao.exception.UserNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class IncidentServiceImplementation implements IncidentService {

    private final IncidentRepository      incidentRepository;
    private final IncidentHistoryRepository incidentHistoryRepository;
    private final UserRepository          userRepository;

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

        // 3. Récupérer l'utilisateur connecté (le Responsable)
        String username = SecurityContextHolder.getContext()
                                               .getAuthentication()
                                               .getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new UserNotFoundException(username));

        // 4. Mémoriser les anciennes valeurs pour le commentaire
        String oldType     = incident.getIncidentType() != null
                             ? incident.getIncidentType().name() : "N/A";
        String oldPriority = incident.getPriority() != null
                             ? incident.getPriority().name() : "N/A";

        // 5. Appliquer la qualification
        incident.setIncidentType(request.getIncidentType());
        incident.setPriority(request.getPriority());
        incidentRepository.save(incident);

        // 6. Tracer dans IncidentHistory
        //    oldStatus / newStatus restent null (pas un changement de statut)
        //    On met le détail dans comment
        IncidentHistory history = new IncidentHistory();
        history.setIncident(incident);
        history.setUser(currentUser);
        history.setOldStatus(null);   // pas de changement de statut
        history.setNewStatus(null);   // pas de changement de statut
        history.setComment(String.format(
                "Qualification — Type : %s → %s | Priorité : %s → %s",
                oldType,     request.getIncidentType().name(),
                oldPriority, request.getPriority().name()));
        // modificationDate est géré automatiquement par @UpdateTimestamp

        incidentHistoryRepository.save(history);

        log.info("Incident {} qualifié par {} → type={} priorité={}",
                incidentId, username,
                request.getIncidentType(), request.getPriority());
    }
}
```

---

## Tests unitaires corrigés — IncidentServiceQualifyTest.java

```java
package com.telecom.dao.service;

import com.telecom.dao.dto.UpdateIncidentQualificationRequest;
import com.telecom.dao.entity.*;
import com.telecom.dao.exception.IncidentNotFoundException;
import com.telecom.dao.exception.InvalidIncidentStateException;
import com.telecom.dao.repository.IncidentHistoryRepository;
import com.telecom.dao.repository.IncidentRepository;
import com.telecom.dao.repository.UserRepository;
import com.telecom.dao.service.impl.IncidentServiceImplementation;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Tests unitaires — qualifyIncident()")
class IncidentServiceQualifyTest {

    @Mock private IncidentRepository        incidentRepository;
    @Mock private IncidentHistoryRepository incidentHistoryRepository;
    @Mock private UserRepository            userRepository;

    @InjectMocks
    private IncidentServiceImplementation incidentService;

    // Mocks Spring Security
    @Mock private SecurityContext    securityContext;
    @Mock private Authentication     authentication;

    private Incident   incident;
    private User       responsable;
    private UpdateIncidentQualificationRequest request;

    @BeforeEach
    void setUp() {
        // Incident en cours (OPEN)
        incident = new Incident();
        incident.setId(1L);
        incident.setTitle("Panne réseau");
        incident.setIncidentStatus(IncidentStatus.OPEN);
        incident.setIncidentType(IncidentType.HARDWARE);
        incident.setPriority(Priority.LOW);

        // Utilisateur connecté
        responsable = new User();
        responsable.setId(10L);
        responsable.setUsername("responsable1");

        // Requête de qualification
        request = new UpdateIncidentQualificationRequest(
                IncidentType.NETWORK,
                Priority.HIGH
        );

        // Simuler Spring Security
        when(authentication.getName()).thenReturn("responsable1");
        when(securityContext.getAuthentication()).thenReturn(authentication);
        SecurityContextHolder.setContext(securityContext);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    // ────────────────────────────────────────────────────────────────────────
    // CAS NOMINAUX
    // ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("✅ Doit mettre à jour le type et la priorité de l'incident")
    void shouldUpdateTypeAndPriority() {
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findByUsername("responsable1")).thenReturn(Optional.of(responsable));
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        incidentService.qualifyIncident(1L, request);

        ArgumentCaptor<Incident> captor = ArgumentCaptor.forClass(Incident.class);
        verify(incidentRepository).save(captor.capture());

        assertThat(captor.getValue().getIncidentType()).isEqualTo(IncidentType.NETWORK);
        assertThat(captor.getValue().getPriority()).isEqualTo(Priority.HIGH);
    }

    @Test
    @DisplayName("✅ Doit enregistrer l'historique avec user + comment + statuts null")
    void shouldSaveHistoryCorrectly() {
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findByUsername("responsable1")).thenReturn(Optional.of(responsable));
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        incidentService.qualifyIncident(1L, request);

        ArgumentCaptor<IncidentHistory> histCaptor =
                ArgumentCaptor.forClass(IncidentHistory.class);
        verify(incidentHistoryRepository).save(histCaptor.capture());

        IncidentHistory saved = histCaptor.getValue();

        // Le user connecté est bien associé
        assertThat(saved.getUser()).isEqualTo(responsable);
        // L'incident est bien associé
        assertThat(saved.getIncident()).isEqualTo(incident);
        // Pas de changement de statut → null
        assertThat(saved.getOldStatus()).isNull();
        assertThat(saved.getNewStatus()).isNull();
        // Le commentaire contient les anciennes et nouvelles valeurs
        assertThat(saved.getComment())
                .contains("HARDWARE")   // ancien type
                .contains("NETWORK")    // nouveau type
                .contains("LOW")        // ancienne priorité
                .contains("HIGH");      // nouvelle priorité
    }

    @Test
    @DisplayName("✅ Doit fonctionner pour un incident sans type ni priorité préalables")
    void shouldHandleNullOldValues() {
        incident.setIncidentType(null);
        incident.setPriority(null);

        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findByUsername("responsable1")).thenReturn(Optional.of(responsable));
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        assertThatCode(() -> incidentService.qualifyIncident(1L, request))
                .doesNotThrowAnyException();

        ArgumentCaptor<IncidentHistory> captor =
                ArgumentCaptor.forClass(IncidentHistory.class);
        verify(incidentHistoryRepository).save(captor.capture());
        // "N/A" pour les valeurs nulles
        assertThat(captor.getValue().getComment()).contains("N/A");
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
        verify(incidentHistoryRepository, never()).save(any());
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

    @Test
    @DisplayName("❌ Doit lever UserNotFoundException si le user n'est pas en base")
    void shouldThrow_whenUserNotFound() {
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(userRepository.findByUsername("responsable1")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> incidentService.qualifyIncident(1L, request))
                .isInstanceOf(UserNotFoundException.class);

        verify(incidentHistoryRepository, never()).save(any());
    }
}
```

---

## Ce qui change par rapport à la version précédente

| Avant (supposé)         | Après (réel)                                  |
|-------------------------|-----------------------------------------------|
| `history.setChangeDescription(...)` | `history.setComment(...)` ✅         |
| `history.setChangedAt(...)` | géré par `@UpdateTimestamp` automatiquement ✅ |
| Pas de user dans history | `history.setUser(currentUser)` obligatoire ✅  |
| UserRepository non utilisé | injecté + mock dans les tests ✅              |
| `oldStatus`/`newStatus` ignorés | explicitement mis à `null` ✅          |
