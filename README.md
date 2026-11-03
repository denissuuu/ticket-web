# Mes Tickets Resto

Application web d'inventaire des titres-restaurant, pensée pour le ou la comptable d'une entreprise : saisie des lots de tickets, suivi des dates de validité, synthèse par période, journal des opérations et import/export CSV.

Aucune dépendance, aucun build : HTML, CSS et JavaScript natifs.

## Fonctionnalités

- **Tableau de bord** : valeur des tickets valides (et montant expiré), nombre de tickets et valeur moyenne, montant qui expire dans les 60 jours, nombre d'émetteurs et de lots.
- **Saisie d'un lot** : émetteur (avec autocomplétion), valeur faciale (raccourcis 8 € → 13 €), quantité, date d'émission et **référence** facultative (n° de facture, bon de commande…). Validation en ligne et aperçu du total. Un lot identique (même émetteur, valeur, date et référence) est fusionné.
- **Dates de validité** : un titre-restaurant est utilisable pendant son année d'émission et jusqu'à fin février de l'année suivante. Les lots expirés sont signalés et ceux qui expirent bientôt sont mis en avant.
- **Synthèse par période** (ce mois, mois dernier, cette année, tout, ou dates libres) : tableau par émetteur et valeur faciale avec sous-totaux et total, **exportable en CSV** et **imprimable** (mise en page dédiée à l'impression / PDF).
- **Inventaire détaillé** : lots regroupés par émetteur, recherche par nom ou référence (raccourci `/`), tri, répartition de la valeur par émetteur, modification et suppression.
- **Journal des opérations** : chaque ajout, modification, suppression ou import est horodaté avec son impact en euros (traçabilité).
- **Annulation** de la dernière action depuis la notification.
- **Import / export CSV** (séparateur `;`, virgule décimale : s'ouvre directement dans Excel en français).
- **Thème clair / sombre** et couleur d'accent personnalisable.
- Responsive (les tableaux passent en cartes sur mobile) et accessible (labels, navigation clavier, `prefers-reduced-motion`).

## Démarrage

Ouvrez simplement `index.html` dans un navigateur récent.

## Technique

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure, sprite d'icônes SVG, dialogues natifs (`<dialog>`) |
| `styles.css` | Design system en variables CSS (thèmes, accent via `color-mix`), grid, feuille d'impression |
| `script.js` | État, logique métier, rendu et gestion des événements |

Quelques choix :

- **État centralisé** (`tickets`, `journal`) + une fonction `render()` : chaque mutation passe par `commit()` (sauvegarde puis rendu). `withUndo()` prend un instantané avant la mutation pour pouvoir l'annuler ; seule la dernière action est annulable, pour ne jamais écraser des opérations plus récentes.
- **Sécurité** : tout texte saisi par l'utilisateur est échappé avant insertion dans le DOM (protection XSS).
- **Montants** : regroupements faits en centimes entiers pour éviter les erreurs d'arrondi des nombres flottants.
- **Dates** manipulées en heure locale (et non en UTC) pour éviter les décalages d'un jour.
- Les données sont stockées dans le `localStorage` ; celles de l'ancienne version sont reprises automatiquement.
d