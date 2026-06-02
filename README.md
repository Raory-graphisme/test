# Live Quiz

Application de regie live pour un jeu en 4 equipes de 2 joueurs, avec affichage public, buzzer telephone, vote public par QR code, timers, scores, malus et import CSV de questions.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir ensuite `http://localhost:5173`.

Pour lancer l'API, il faut une base PostgreSQL. Cree une base PostgreSQL, puis renseigne `DATABASE_URL` dans `.env`.

Pour un test local avec Docker :

```bash
docker compose up -d
cp .env.example .env
# puis de-commente DATABASE_URL dans .env
npm install
npm run dev
```

Sans Docker, laisse `DATABASE_URL` vide dans `.env` : l'app utilise un mode test en memoire. Sur Railway, il faut garder la vraie variable `DATABASE_URL`.

## Deploiement Railway

1. Pousser le projet sur GitHub.
2. Creer un nouveau projet Railway depuis le repo GitHub.
3. Ajouter un service PostgreSQL.
4. Ajouter les variables :
   - `DATABASE_URL`, fournie par Railway PostgreSQL
   - `ADMIN_PASSWORD=lisaa`
5. Generer le domaine public sur le port indique dans les logs Railway, souvent `8080`.
6. Railway lance `npm start` apres le build.

## Pages

- `/` : vue publique par defaut.
- `/screen` : vue grand ecran pour afficher question et classement.
- `/admin` : controle de la partie.
- `/buzzer/1` et `/buzzer/2` : buzzers telephone pour les 2 telephones prepares.
- `/vote` : vote public.

Le mot de passe admin par defaut est `lisaa`.

Les QR codes ne sont jamais affiches automatiquement sur l'ecran public. Depuis l'admin, utilise le bouton `Afficher QR` uniquement au moment voulu.

## Format CSV

Colonnes attendues :

```csv
order,round,pool,type,theme,prompt,answer,imageUrl,imageUrlB,optionA,optionB,optionC,optionD,durationSeconds,blurLevel
```

Valeurs utiles :

- `round` : `round1`, `stroop`, `round2`, `drawing`, `round3`, `dragon`
- `type` : `text`, `truefalse`, `image`, `compare`, `blur`, `zoom`, `flash`
- `order` : ordre exact de passage pour faire les raccords presentateur/regie

Un exemple est fourni dans `sample-questions.csv`.
