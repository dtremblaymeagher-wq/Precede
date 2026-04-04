# PRODUCT-SPEC.md
> Charger uniquement pour des questions de stratégie produit, pricing, use cases clients, ou phases d'implémentation.
> Pour le code : voir CLAUDE.md. Pour la spec roadmap UI : voir ROADMAP-SPEC.md.

---

## MONETIZATION

| Plan | Prix | Limites clés |
|------|------|-------------|
| FREE | $0 | 1 instance · manuel uniquement · 3 brainstorms/mois · copy to Jira (pas push) · 1 Executive (dashboard limité) |
| PRO | $49/mois | 1 instance · automation · push Jira · analyses auto · brainstorms illimités · 1 Executive (full) |
| TEAM | $150/mois base + $49/PM additionnel | Base = 2 PMs Pro + 1 Executive · instances illimitées · Jira partagé · dashboard exec consolidé |

Pricing TEAM : 2 PMs=$150 · 3=$199 · 5=$297 · 10=$542

**Principes clés :**
- Free = tout fonctionne manuellement (trial implicite)
- Upgrade triggers : Push Jira · 4e analyse manuelle · 3e Brainstorm · besoin multi-instance
- Executive toujours gratuit → vecteur de croissance, pas de revenue
- Copy to Jira = free · Push to Jira = Pro

---

## INSTANCE ARCHITECTURE

**Définition :** workspace virtuel isolé dans un même login (comme Slack workspaces).
Chaque instance a ses propres : Vision/OKRs · Personas/Clients · Hub · Radar · Backlog · Grooming · Meetings · Settings · Jira config · Learning Vault · Decisions · Brainstorms · Roadmap scenarios

**Partagé entre instances :** Auth · Subscription · UI/navigation

**Instance switcher :** visible sidebar quand ≥2 instances · dropdown léger · couleur/badge par instance

**Migration utilisateurs existants :** créer instance "Default" automatiquement, attacher toutes les données existantes → transparent.

### Use cases

| Case | Pattern | Plan |
|------|---------|------|
| 1 PM · 1 produit · 1 backlog | 1 instance · 1 Jira | Pro |
| 1 PM · 1 produit · N backlogs · N squads | 1 instance · N Jira projects (Petal/Carebook) | Pro ou Team |
| 1 PM · N produits · N backlogs | N instances isolées (Prehos/consultant) | Team |
| N PMs · N produits · N backlogs | Chaque PM a ses instances | Team |
| N PMs · N produits · 1 Jira partagé | Instances séparées · même Jira connection · filtres différents (Prehos) | Team |

**Règle clé :** "PM Lead" n'est pas un rôle dans Precede. Analystes/exécutants n'ont pas de compte. Besoin de radar consolidé → rôle Executive. 1 PM par instance.

### Instance Transfer

Ce qui transfère : Jira connection · Backlog · Settings · Learning Vault
Ce qui devient read-only : Hub signals historiques · Radar analyses · Decision history

Flow : initié par ancien PM ou Executive → nouveau PM peut "poser des questions d'abord" → Q&A archivé comme contexte permanent de l'instance.

---

## SQUAD ARCHITECTURE

S'applique uniquement quand 1 instance a N backlogs (Case 2).
Chaque squad = 1 Jira project/filter. Si 1 seul squad → UI squad masquée automatiquement.

**Per product (consolidé) :** Vision/OKRs · Hub · Radar · Churn Risk · Signal Coverage · OKR Alignment
**Per squad (côte à côte) :** Sprint Scope Drift · Epic Health · Focus Guard · Signal to Delivery · Backlog

Squad Health section : tous les squads visibles simultanément, pas de switcher. Si 3+ squads : scroll horizontal ou accordion.

---

## JIRA INTEGRATION

### Modes
- **Full Sync** (Pull + Push) : Jira = source primaire backlog. Précède lit + pousse. Pour Jira bien structuré (Petal, Carebook).
- **Push Only** : Précède ne lit pas Jira. Hub = source intelligence. Précède pousse uniquement les stories groomées. Pour Jira chaotique partagé (Prehos).

Config au setup : choix entre les deux modes.

### Connexions partagées (Team plan)
PMs sur même Jira ne re-saisissent pas les credentials.
Flow : "Connexions existantes dans ton équipe : ● Prehos Jira (par PM David) [Utiliser →]"
Chaque instance référence `jira_connection_id` + son propre filtre.

### Historical Import & Cold Start

PM configure sa tenure au setup :
- Durée avec l'équipe : <3m · 3-6m · 6-12m · 1-2a · 2a+
- Y avait-il un PM avant toi ? Oui/Non/NSP

Import depuis la date de tenure uniquement. Avant = bruit, ignoré.

**Ce qu'on importe :**
- ✅ Epics actifs · Epics complétés (période tenure) · Stories sprint actuel · Stories complétées (3 derniers mois) · Commentaires epics actifs
- ❌ Stories complétées >12 mois (si tenure <12m) · Tickets sans epic · Subtasks · Tickets ops/incidents

**Flow onboarding (objectif ≤10 min) :**
1. Vision & OKRs (2 min)
2. Config sprint (2 min)
3. Connexion Jira + tenure (2 min) → import auto
4. **"Ton Predictive Roadmap est prêt"** ← wow moment
5. 3 questions pour seeder le Hub (2 min)

**3 questions onboarding (max) :**
- Q1 : "Quel est ton plus grand risque client en ce moment ?"
- Q2 : "Qu'est-ce qui revient dans tes 3 derniers sprints sans jamais être adressé ?"
- Q3 : "Que va te demander ton manager sur ton produit à la prochaine réunion ?"
→ Chaque réponse = entrée Hub auto → déclenche 1ère analyse Radar.

---

## EXECUTIVE DASHBOARD

### Structure (3 sections)

**Section 1 — Strategic Alignment**
- Widget 1A : OKR Horizontal Alignment Trend (6 sprints)
- Widget 1B : OKR Vertical Alignment (PM vs Exec OKRs · PM vs autres PMs)
- Widget 2 : Signal Coverage Rate (6 sprints)
- Widget 3 : Vision Drift + Discovery Tracking
- Widget 4 : Focus Guard Trend (6 sprints)

**Section 2 — Team Pulse**
- Widget 5 : Sprint Scope Drift
- Widget 6 : Signal to Delivery Velocity
- Widget 7 : Epic Health

**Section 3 — Forward Look**
- Widget 8A : Predictive Timeline (projections epics vs milestones)
- Widget 8B : Signal-Based Recommendations (3 prochains sprints)
- Widget 9 : Risk Trajectory (si rien ne change → 3 sprints)
- Widget 10 : Decisions Required

**OKR Alignment :** chaque PM définit ses OKRs indépendamment. Executive définit les siens séparément. Widget 1B détecte divergences automatiquement → signaux stratégiques, pas des erreurs.

**Free preview rule :** 1 génération gratuite. Après → données gelées avec badge "Outdated". Valeur réelle seulement avec N PMs (Team plan).

### Ce que l'Executive N'a PAS besoin (ne pas implémenter)
- Page roadmap dédiée · Builder roadmap manuel · Créer ses propres epics · Annual roadmap builder
- Rationale : valeur exec vient de l'intelligence connectée. Présentations board → export depuis Précède + PowerPoint.

### Ce que l'Executive a besoin pour le roadmap
Widget 8A enrichi : tous les milestones · confidence par milestone · [Voir roadmap complet →]
"Voir roadmap complet" → timeline read-only consolidée · vue trimestrielle · tous PMs côte à côte · export PNG/PDF/lien.

---

## DECISIONS FLOW

**3 flux :**
1. Auto-détecté (Précède → Executive → PM si besoin)
2. PM-escaladé via Solution Mode
3. Exec-initié via Solution Mode

### Seuils de déclenchement

**CRITICAL (immédiat) :**
- Churn risk projeté CRITICAL dans 2 sprints
- OKR projeté manqué avec 2 sprints restants
- Epic scope +150% en phase Development
- Vision Drift >60% deux sprints consécutifs
- Signal Coverage <35% deux sprints consécutifs

**WARNING (dans 1 sprint) :**
- Churn risk projeté HIGH dans 3 sprints
- OKR projeté manqué avec 3 sprints restants
- Epic scope +100% en phase Development
- Sprint Scope Drift CRITICAL deux fois consécutivement
- Signal Coverage <50% trois sprints consécutifs

**Archive décision :** contexte · snapshots indicateurs · tous rounds de conversation · décision finale · outcome évalué auto post-sprint.

---

## SOLUTION MODE

Bouton sidebar "⚡ Solution Mode" → remplace le bouton Escalation séparé.
Flow : clic → banner "Solution mode — cliquer un élément pour ajouter contexte" → outline indigo sur hover widgets/stories/signals → clic = sélection → panel latéral : [💡 Brainstorm avec AI] ou [🚩 Escalader à l'Exec].

Disponible dans : PM Dashboard · Backlog · Hub · Radar · Meeting · Executive (pour initier décisions).

---

## BRAINSTORM STUDIO

**2 points d'entrée :** sidebar "💡 Brainstorm Studio" (question ouverte) · Solution Mode → Brainstorm (problème spécifique avec contexte)

**Contexte injecté :** Vision + OKRs + Hub récent + dernier Radar + décisions récentes + Epic Health + Learning Vault + éléments sélectionnés (Solution Mode uniquement)

**Gate freemium :** FREE = 3 brainstorms complets/mois · PRO = illimité

---

## MILESTONES

**2 sources :**
1. PM crée directement dans Roadmap (clic sur timeline ou [+ Add Milestone]) · form : nom · date · type Internal/External · epic(s) liés · note
2. Executive suggère → PM approuve/négocie/rejette · badge [Exec] · exec peut marquer non-négociable (contractuel) → Decision Required urgent

**Affichage :** lignes verticales · vert/orange/rouge · confidence calculée auto depuis epics liés · alerte si confidence <50% avec <3 sprints.

---

## IMPLEMENTATION PHASES

| Phase | Statut | Contenu |
|-------|--------|---------|
| 1 | ✅ Current | 1 instance implicite · toutes features existantes |
| 2 | Pro launch | Instance switcher · Jira modes · Predictive Roadmap V1 · Brainstorm Studio · Solution Mode |
| 3 | Team launch | Team management · Jira partagé · Dashboard Exec · Transfers · Decisions flow · Milestones |
| 4 | V2 | Epic Evolution Analyzer · PM Estimation Coaching · Market segments · Sprint Review auto · Exec Viewer · Multi-exec brainstorm · Velocity trends · Epic dependencies |
