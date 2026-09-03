# Flyway Migrations — Users + Incidents

## Étape 1 — Générer les vrais hash BCrypt

Crée cette classe, **lance-la une fois**, copie les hash dans le SQL.

### PasswordHashGenerator.java

```java
package com.telecom.utils;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

public class PasswordHashGenerator {

    public static void main(String[] args) {
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(10);

        String[] passwords = {
            "Admin@2024",
            "Resp@2024",
            "Tech@2024"
        };

        for (String pwd : passwords) {
            System.out.println("Password : " + pwd);
            System.out.println("Hash     : " + encoder.encode(pwd));
            System.out.println("---");
        }
    }
}
```

**Output exemple (chaque exécution donne des hash différents — c'est normal) :**
```
Password : Admin@2024
Hash     : $2a$10$xMbLLVMjTvFz1vNNiAkCxO4G...
Password : Resp@2024
Hash     : $2a$10$yKqL9PzRmT8wXnBj2cFdEe3H...
Password : Tech@2024
Hash     : $2a$10$zNrM0QaSuV9vYoCk3dGeEf4I...
```

---

## Étape 2 — V2__insert_users.sql

```sql
-- ============================================================
-- V2__insert_users.sql
-- Mots de passe en clair (pour tes tests Postman) :
--   admin        → Admin@2024
--   responsable1 → Resp@2024
--   responsable2 → Resp@2024
--   technicien1  → Tech@2024
-- ⚠️ Remplace les hash ci-dessous par ceux générés par
--    PasswordHashGenerator.java
-- ============================================================

INSERT INTO users (username, email, password, role, first_name, last_name, enabled, created_at)
VALUES
    (
        'admin',
        'admin@telecom.com',
        '$2a$10$REMPLACE_PAR_HASH_Admin@2024',   -- ← coller ici
        'ADMIN',
        'Super',
        'Admin',
        true,
        CURRENT_DATE
    ),
    (
        'responsable1',
        'responsable1@telecom.com',
        '$2a$10$REMPLACE_PAR_HASH_Resp@2024',    -- ← coller ici
        'RESPONSABLE',
        'Jean',
        'Dupont',
        true,
        CURRENT_DATE
    ),
    (
        'responsable2',
        'responsable2@telecom.com',
        '$2a$10$REMPLACE_PAR_HASH_Resp@2024',    -- ← coller ici
        'RESPONSABLE',
        'Marie',
        'Martin',
        true,
        CURRENT_DATE
    ),
    (
        'technicien1',
        'tech1@telecom.com',
        '$2a$10$REMPLACE_PAR_HASH_Tech@2024',    -- ← coller ici
        'TECHNICIEN',
        'Paul',
        'Bernard',
        true,
        CURRENT_DATE
    );
```

---

## Étape 3 — V3__insert_incidents.sql

```sql
-- ============================================================
-- V3__insert_incidents.sql
-- Dépend de V2 (les users doivent exister)
-- ============================================================

INSERT INTO incidents (
    title,
    description,
    incident_type,
    priority,
    incident_status,
    area,
    client_impact,
    user_id,
    created_at,
    updated_at
)
VALUES
    (
        'Panne réseau datacenter Paris',
        'Interruption totale de la connectivité sur le datacenter Paris-Nord',
        'NETWORK',
        'CRITICAL',
        'OPEN',
        'Paris-Nord',
        'Tous les clients entreprise zone Nord impactés',
        (SELECT id FROM users WHERE username = 'responsable1'),
        NOW(),
        NOW()
    ),
    (
        'Serveur de messagerie HS',
        'Le serveur de messagerie ne répond plus depuis 8h00',
        'SOFTWARE',
        'HIGH',
        'IN_PROGRESS',
        'Lyon',
        '500 utilisateurs sans accès mail',
        (SELECT id FROM users WHERE username = 'responsable1'),
        NOW(),
        NOW()
    ),
    (
        'Disque dur défaillant',
        'Disque dur en RAID dégradé sur serveur de fichiers',
        'HARDWARE',
        'MEDIUM',
        'OPEN',
        'Marseille',
        'Risque de perte de données si second disque tombe',
        (SELECT id FROM users WHERE username = 'responsable2'),
        NOW(),
        NOW()
    ),
    (
        'Tentative intrusion détectée',
        'Multiples tentatives de connexion SSH suspectes depuis IP externe',
        'SECURITY',
        'HIGH',
        'OPEN',
        'Bordeaux',
        'Risque sécurité sur infrastructure critique',
        (SELECT id FROM users WHERE username = 'responsable2'),
        NOW(),
        NOW()
    ),
    (
        'Imprimante réseau hors service',
        'Imprimante du service comptabilité inaccessible',
        'OTHER',
        'LOW',
        'OPEN',
        'Paris-Sud',
        'Service comptabilité bloqué pour impressions',
        (SELECT id FROM users WHERE username = 'responsable1'),
        NOW(),
        NOW()
    );
```

---

## Nomenclature Flyway — où placer ces fichiers

```
src/main/resources/
└── db/
    └── migration/
        ├── V1__create_tables.sql     ← déjà existant (schéma)
        ├── V2__insert_users.sql      ← nouveau
        └── V3__insert_incidents.sql  ← nouveau
```

---

## Vérification dans Postman

```
POST /api/auth/login
{
  "username": "responsable1",
  "password": "Resp@2024"
}
```

```
PATCH /api/incidents/1/qualify
{
  "incidentType": "NETWORK",
  "priority": "HIGH",
  "userId": 2
}
```

```
GET /api/incidents/1/history
```
