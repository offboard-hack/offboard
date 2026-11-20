# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Offboard serves HR and People Ops teams in Brazil that coordinate employee departures. Departing employees are the people the career transition support is meant to help.

## Product Purpose

Offboard helps HR coordinate departures and helps departing employees make their next career move. HR can track what needs to happen during a departure and see aggregate transition outcomes while individual job-search activity remains private.

## Operating Context

The HR portal uses Brazilian Portuguese and the terminology of Brazilian offboarding workflows, including desligamento, RH and DP, and rescisão. A departure can involve administrative tasks, equipment returns, and access changes across teams.

## Capabilities and Constraints

- The HR demo shows departure cases, checklists, CSV import, equipment collection, access and permissions, integrations, and aggregate transition reporting.
- HR sees transition outcomes in aggregate. Individual résumés, applications, and messages remain private.
- Integration activity and billing figures shown in the demo are illustrative.

## Brand Commitments

The product is named Offboard. The HR workspace is labeled “Portal do RH” in the interface.

## Evidence on Hand

- `src/entities/offboarding.ts` contains example departure cases and tasks.
- `public/modelo-desligamentos.csv` is the bulk-import template.
- `public/offboard-icon.svg` is the app icon.

## Product Principles

- Give HR a clear view of what is complete, what is pending, and which team owns the next step.
- Carry career transition support beyond the administrative close of a departure.
- Protect individual job-search activity when reporting transition outcomes to HR.
