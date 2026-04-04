# ROADMAP-SPEC.md
> Charger uniquement pour des questions sur la page Roadmap, les milestones, le dashboard exec (roadmap),
> les scénarios, ou l'alignement Jira story-by-story.
> Pour le code : voir CLAUDE.md. Pour pricing/phases/use cases : voir PRODUCT-SPEC.md.

---

## PAGE LAYOUT — Video editor pattern

```
┌─────────────────────────────────────────┐
│  TOP — Result view (read-only)          │
│  État du roadmap à la date du curseur   │
│  % completion par epic · best/likely/   │
│  worst case · status vs milestones      │
├──────────────────┬──────────────────────┤
│                  │ curseur vertical      │
├──────────────────┴──────────────────────┤
│  BOTTOM — Gantt controls (interactif)   │
│  Drag & drop · scrubbing souris         │
│  Snap sur : dates milestones · bornes   │
│  de sprint                              │
└─────────────────────────────────────────┘
```

Déplacer le curseur dans le bas met à jour le haut en temps réel.

---

## VUES (3 onglets)

### [Current Order]
- Miroir de l'ordre réel du backlog Jira
- Recalculé à chaque sync Jira
- Jamais modifié par Précède
- Message : "ce qui se passera si tu gardes ton ordre actuel"

### [Scenario]
- PM réordonne les epics par drag & drop
- Simulation théorique — jamais poussée vers Jira
- Superposée sur Current Order dans la même timeline
- Usage : préparation sprint planning · présentation exec · exploration avant décision dans Jira

### [List] ← V2
- Mêmes données en tableau
- Colonnes : Epic · Stories · Start · End · Confidence · Status
- Export : CSV · Copy as table · Shareable link
- Implémenter si demande avérée

---

## GRADIENT CONFIDENCE BARS

```
░░░░▓▓▓▓████
possible → probable → certain
```

- Solide à DROITE = worst case = complétion certaine (confidence >90%)
- Dégradé vers gauche = plus tôt mais moins certain
- Zone probable (milieu) : confidence 50-80% = most likely
- Zone possible (gauche, pâle) : confidence <50% = best case

---

## CALCUL DES INTERVALLES DE CONFIANCE

| Scénario | Scope | Velocity | Carry-over |
|----------|-------|----------|------------|
| Best case | current × 1.05 | max observé 6 derniers sprints | min historique |
| Most likely | current × (1 + avg creep)^sprints | moyenne pondérée (récents = plus de poids) | moyenne historique |
| Worst case | current × (1 + max creep)^sprints | min observé (hors sprints exceptionnels) | max historique |

---

## MODÈLE DE VELOCITY (V1 — implémenté dans roadmap-routes.js)

```
Effective velocity = raw_velocity
                   × (1 - carry_over_rate)
                   × feature_pct
                   × priority_share
```

Priority shares (apprises depuis l'historique, defaults jusqu'à data suffisante) :
P1=48% · P2=29% · P3=16% · P4+=7%

Scope creep defaults par phase :
- Discovery : +50% · Refinement : +20% · Development : +10% · Completion : +3%

Alerte quand croissance dépasse la norme de phase.
Modèle se recalibre après chaque sprint complété.

Déduction de l'ordre epic depuis le backlog Jira :
Stories de l'epic A aux positions 1,3,5,8 → avg 4.25 → priority 1
Stories de l'epic B aux positions 2,6,9 → avg 5.67 → priority 2
Imparfait mais suffisant pour la vue initiale. PM ajuste via Scenario.

---

## JIRA SYNC — comportement

✅ À chaque sync :
- Mettre à jour le nombre de stories par epic
- Mettre à jour les stories complétées
- Recalculer toutes les projections
- Détecter les nouveaux epics (affichés "Unpositioned")
- Mettre à jour le modèle de velocity

❌ Jamais :
- Modifier l'ordre du backlog Jira
- Modifier le rank des epics dans Jira

Résumé post-sync à afficher :
```
⚡ Jira synced · [date] · N changements détectés
Epic A : 14 → 17 stories · projeté S15 → S16 ⚠️
Epic B : 2 stories complétées · projeté S14 → S13 ✅
1 nouvel epic : 'API Rate Limiting' — non positionné
[Positionner dans le roadmap →]
```

---

## SCÉNARIOS — save & share

Sauvegarder un scénario : nom · note (optionnel) · visibilité Private/Share with Executive

- Partage = information uniquement, pas de workflow d'approbation
- Executive voit le scénario dans son dashboard comme contexte
- Si exec veut réagir → Decisions flow existant

Export :
- 🔗 Lien partageable (read-only · interactif · watermark "Made with Precede · precede.io")
- 📊 PNG
- V2 : PDF · CSV

---

## ALIGN TO SCENARIO (story-by-story)

**Principe :** Précède suggère des mouvements de stories individuels pour aligner progressivement le Current Order vers le scénario cible.

**Flow :**
1. PM active "Align to scenario"
2. Précède analyse le prochain sprint uniquement
3. Suggère ~48% de la capacité sprint en stories de l'epic prioritaire (basé sur historique)
4. PM voit : `[Apply all] [Review one by one] [Cancel]`
5. Chaque move appliqué → 1 appel API Jira (champ Rank) → Current Order recalcule en temps réel

**Warning obligatoire avant application :**
> "This will modify your Jira backlog. Changes cannot be automatically undone."

**Règles absolues :**
- 1 story à la fois — jamais de bulk
- Toujours avec confirmation PM
- Toujours montrer l'impact avant d'appliquer
- Après sprint aligné : "Sprint 13 aligné ✅ — Continuer avec Sprint 14 ?"

---

## MILESTONES

### 2 sources

**Source 1 — PM crée dans Roadmap**
- Clic sur date timeline OU bouton [+ Add Milestone]
- Form : Nom · Date · Type (Internal/External) · Epic(s) liés (multi-select) · Note
- Visible dans : PM Roadmap · sprint context du PM Dashboard
- Non visible par l'Executive sauf si partagé

**Source 2 — Executive suggère**
- PM options : Accepter / Négocier / Rejeter
- Executive peut marquer "non-négociable" (contractuel) → génère Decision Required urgent
- Badge [Exec] pour distinguer des milestones PM
- Même affichage une fois approuvé

**Comportement commun :**
- Ligne verticale sur la timeline
- Couleur : vert (on track) · orange (watch) · rouge (at risk)
- Confidence calculée auto depuis les epics liés
- Curseur snap sur la date milestone
- Alerte auto si confidence <50% avec <3 sprints restants → Decision Required

### Panneau liste milestones (optionnel)
```
[Milestones ▼]
🏁 Apr 15 · Board Demo          [PM]
   Enterprise Onboarding : 67% ⚠️
   Jira Integration : 84% ✅
   Confidence : 52%

🏁 May 1 · Client 3 Demo        [Exec]
   Mobile Companion : 28% 🚨
   Confidence : 31%

[+ Add Milestone]
```

---

## ALERTES PROACTIVES → PM Dashboard

Après chaque sync Jira, le Roadmap engine vérifie :

**CRITICAL (affiché immédiatement) :**
- Milestone qui était on track → maintenant at risk
- Scope creep dépasse la norme de phase en Development
- Epic complété plus tôt que projeté (positif → capacité libérée)

**WATCH (affiché au démarrage de sprint) :**
- Velocity en baisse 2+ sprints
- Nouveaux epics sans position dans le roadmap
- Scénario diverge significativement du Current Order

Affichage dans PM Dashboard : section "🗺️ Roadmap Alerts (N)" · chaque alerte a [View in Roadmap →] qui ouvre la page avec le curseur à la date concernée et l'epic highlighté.

Si alerte = milestone critical miss → Roadmap alert ET Decision Required générés simultanément.

V1 : alertes dashboard uniquement · V2 : digest email hebdo · notif Slack/Teams

---

## CE QUI N'EST PAS DANS LE SCOPE (ne pas implémenter)

| Feature | Raison |
|---------|--------|
| Push de l'ordre epic vers Jira | Stories sont interleaved → dangereux et complexe |
| Builder roadmap executive | Pas de valeur vs PowerPoint/Notion |
| Live scenarios (auto-update) | Scenario order ≠ Jira order → divergerait immédiatement |
| Workflow approbation scénario PM↔Exec | Complexité inutile · Decisions flow couvre ce besoin |
| Table `executive_roadmap_items` | Milestone table couvre déjà le besoin |

**Ce que les scénarios SONT :**
- Simulations pour préparer le sprint planning
- Propositions à présenter à l'exec ou à l'équipe
- Explorations what-if avant de décider dans Jira
- PM décide et applique manuellement dans Jira
- Précède assiste via Align to scenario (story par story)

---

## DASHBOARD EXEC — Vue roadmap

Widget 8A enrichi avec :
- Tous les milestones de tous les PMs/instances
- Confidence par milestone
- Epics liés et leur status
- Lien [Voir roadmap complet →]

"Voir roadmap complet" ouvre :
- Timeline read-only consolidée
- Vue trimestrielle (pas au niveau sprint)
- Tous les PMs côte à côte
- Overlay milestones
- Gradient confidence par initiative
- Pas de drag & drop · pas d'édition
- Export : PNG · PDF · Lien partageable

Suffisant pour les board presentations (quelques fois/an).
Les alertes dashboard + Decisions Required couvrent les besoins quotidiens.
