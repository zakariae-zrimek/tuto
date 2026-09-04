# 📋 README — Test du Workflow Complet Incident

## Vue d'ensemble

```
[1] Qualifier l'incident      PATCH /api/incidents/{id}/qualify
        ↓
[2] Changer statut → IN_PROGRESS   PATCH /api/incidents/{id}/status
        ↓
[3] Changer statut → RESOLVED      PATCH /api/incidents/{id}/status
        ↓
[4] Clôturer → CLOSED              PATCH /api/incidents/{id}/status
        ↓
[5] Consulter l'historique         GET   /api/incidents/{id}/history
```

---

## ⚙️ Prérequis

### 1. Vérifier application.yml

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/telecom_db
    username: root
    password: tonMotDePasse
  jpa:
    hibernate:
      ddl-auto: validate
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true
```

### 2. Vérifier les migrations Flyway

```
db/migration/
├── V1__create_tables.sql       ✅
├── V2__insert_users.sql        ✅ (avec hash BCrypt générés)
├── V3__insert_incidents.sql    ✅
├── V4__insert_incident_assignments.sql  ✅
└── V5__insert_incident_history.sql      ✅
```

### 3. Vérifier la sécurité désactivée temporairement

```java
// SecurityConfig.java
http.csrf(csrf -> csrf.disable())
    .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
```

### 4. Démarrer l'application

```
Run TelecomApplication
```

Logs attendus :
```
Flyway: Successfully applied 5 migrations ✅
Started TelecomApplication in 3.2 seconds ✅
```

---

## 🗄️ Données en base (après migrations)

### Users disponibles

| id | username      | password    | role        |
|----|---------------|-------------|-------------|
| 1  | admin         | Admin@2024  | ADMIN       |
| 2  | responsable1  | Resp@2024   | RESPONSABLE |
| 3  | responsable2  | Resp@2024   | RESPONSABLE |
| 4  | technicien1   | Tech@2024   | TECHNICIEN  |
| 5  | technicien2   | Tech@2024   | TECHNICIEN  |

### Incidents disponibles

| id | title                          | status | type     | priority |
|----|-------------------------------|--------|----------|----------|
| 1  | Panne réseau datacenter Paris  | OPEN   | NETWORK  | CRITICAL |
| 2  | Serveur de messagerie HS       | OPEN   | SOFTWARE | HIGH     |
| 3  | Disque dur défaillant          | OPEN   | HARDWARE | MEDIUM   |
| 4  | Tentative intrusion détectée   | OPEN   | SECURITY | HIGH     |
| 5  | Imprimante réseau hors service | OPEN   | OTHER    | LOW      |

---

## 🧪 Scénario de test complet — Incident 1

> On va faire évoluer l'incident 1 de OPEN jusqu'à CLOSED
> en passant par toutes les étapes.

---

### ÉTAPE 1 — Qualifier l'incident

**Rôle : RESPONSABLE (userId = 2)**

```
PATCH http://localhost:8080/api/incidents/1/qualify
Content-Type: application/json

{
  "incidentType": "NETWORK",
  "priority": "CRITICAL",
  "userId": 2
}
```

**Réponse attendue :**
```
200 OK
```

**Ce qui se passe en base :**
- `incidents` : `incident_type = NETWORK`, `priority = CRITICAL`
- `incident_history` : nouvelle ligne avec `comment = "Qualification — Type : NETWORK → NETWORK | Priorité : CRITICAL → CRITICAL"`, `old_status = null`, `new_status = null`

---

### ÉTAPE 2 — Requalifier (2ème qualification)

**Pour tester que l'historique trace bien les 2 changements**

```
PATCH http://localhost:8080/api/incidents/1/qualify
Content-Type: application/json

{
  "incidentType": "SOFTWARE",
  "priority": "HIGH",
  "userId": 2
}
```

**Réponse attendue :**
```
200 OK
```

---

### ÉTAPE 3 — Changer statut OPEN → IN_PROGRESS

**Rôle : TECHNICIEN (userId = 4)**

```
PATCH http://localhost:8080/api/incidents/1/status
Content-Type: application/json

{
  "newStatus": "IN_PROGRESS",
  "comment": "Prise en charge immédiate",
  "userId": 4
}
```

**Réponse attendue :**
```
200 OK
```

**Ce qui se passe en base :**
- `incidents` : `incident_status = IN_PROGRESS`
- `incident_history` : nouvelle ligne avec `old_status = OPEN`, `new_status = IN_PROGRESS`

---

### ÉTAPE 4 — Tester une transition INVALIDE

**Essayer OPEN → RESOLVED (interdit par le workflow)**

```
PATCH http://localhost:8080/api/incidents/2/status
Content-Type: application/json

{
  "newStatus": "RESOLVED",
  "userId": 4
}
```

**Réponse attendue :**
```
409 Conflict
"Transition invalide : OPEN → RESOLVED n'est pas autorisée"
```

✅ Le workflow est respecté !

---

### ÉTAPE 5 — Changer statut IN_PROGRESS → RESOLVED

```
PATCH http://localhost:8080/api/incidents/1/status
Content-Type: application/json

{
  "newStatus": "RESOLVED",
  "comment": "Problème résolu, serveur redémarré",
  "userId": 4
}
```

**Réponse attendue :**
```
200 OK
```

---

### ÉTAPE 6 — Changer statut RESOLVED → CLOSED

```
PATCH http://localhost:8080/api/incidents/1/status
Content-Type: application/json

{
  "newStatus": "CLOSED",
  "comment": "Incident clôturé après validation",
  "userId": 2
}
```

**Réponse attendue :**
```
200 OK
```

---

### ÉTAPE 7 — Tester statut terminal CLOSED

**Essayer de modifier un incident clôturé (interdit)**

```
PATCH http://localhost:8080/api/incidents/1/status
Content-Type: application/json

{
  "newStatus": "OPEN",
  "userId": 4
}
```

**Réponse attendue :**
```
409 Conflict
"Transition invalide : CLOSED → OPEN n'est pas autorisée"
```

---

### ÉTAPE 8 — Consulter l'historique complet

```
GET http://localhost:8080/api/incidents/1/history
```

**Réponse attendue :**
```json
[
  {
    "id": 1,
    "actionNumber": 1,
    "oldStatus": null,
    "newStatus": null,
    "comment": "Qualification — Type : NETWORK → SOFTWARE | Priorité : CRITICAL → HIGH",
    "modifiedBy": "responsable1",
    "modifiedByFullName": "Jean Dupont",
    "modificationDate": "04/09/2026 09:00:00"
  },
  {
    "id": 2,
    "actionNumber": 2,
    "oldStatus": null,
    "newStatus": null,
    "comment": "Qualification — Type : NETWORK → SOFTWARE | Priorité : CRITICAL → HIGH",
    "modifiedBy": "responsable1",
    "modifiedByFullName": "Jean Dupont",
    "modificationDate": "04/09/2026 09:05:00"
  },
  {
    "id": 3,
    "actionNumber": 3,
    "oldStatus": "OPEN",
    "newStatus": "IN_PROGRESS",
    "comment": "Prise en charge immédiate",
    "modifiedBy": "technicien1",
    "modifiedByFullName": "Paul Bernard",
    "modificationDate": "04/09/2026 09:10:00"
  },
  {
    "id": 4,
    "actionNumber": 4,
    "oldStatus": "IN_PROGRESS",
    "newStatus": "RESOLVED",
    "comment": "Problème résolu, serveur redémarré",
    "modifiedBy": "technicien1",
    "modifiedByFullName": "Paul Bernard",
    "modificationDate": "04/09/2026 09:15:00"
  },
  {
    "id": 5,
    "actionNumber": 5,
    "oldStatus": "RESOLVED",
    "newStatus": "CLOSED",
    "comment": "Incident clôturé après validation",
    "modifiedBy": "responsable1",
    "modifiedByFullName": "Jean Dupont",
    "modificationDate": "04/09/2026 09:20:00"
  }
]
```

---

## ✅ Checklist de validation

| Test | Endpoint | Résultat attendu | ✅/❌ |
|------|----------|-----------------|-------|
| Qualification 1ère fois | PATCH /qualify | 200 OK | |
| Qualification 2ème fois | PATCH /qualify | 200 OK | |
| OPEN → IN_PROGRESS | PATCH /status | 200 OK | |
| OPEN → RESOLVED (invalide) | PATCH /status | 409 Conflict | |
| IN_PROGRESS → RESOLVED | PATCH /status | 200 OK | |
| RESOLVED → CLOSED | PATCH /status | 200 OK | |
| CLOSED → OPEN (invalide) | PATCH /status | 409 Conflict | |
| Historique — 5 entrées | GET /history | 200 + liste triée | |
| Historique — oldStatus rempli | GET /history | OPEN, IN_PROGRESS... | |
| Historique — modifiedBy présent | GET /history | username + fullName | |

---

## 🔁 Résumé des endpoints

| Méthode | URL | Rôle | Body |
|---------|-----|------|------|
| PATCH | `/api/incidents/{id}/qualify` | RESPONSABLE | `incidentType, priority, userId` |
| PATCH | `/api/incidents/{id}/status` | TECHNICIEN | `newStatus, comment, userId` |
| GET | `/api/incidents/{id}/history` | TOUS | — |

---

## ❗ Erreurs fréquentes

| Erreur | Cause | Solution |
|--------|-------|----------|
| `409 Conflict` sur /status | Transition non autorisée | Respecter le workflow |
| `404 Not Found` | incident ou user inexistant | Vérifier les ids en base |
| `400 Bad Request` | Champ null dans le body | Vérifier le JSON envoyé |
| `Flyway checksum mismatch` | Fichier SQL modifié après exécution | `DELETE FROM flyway_schema_history WHERE version IN ('2','3','4','5')` |
