# Interview Transcript: security-code-review

**Date:** 2026-01-07
**Project:** HotStock
**Feature:** security-code-review

---

## Question 1 - Problem

**Q:** What problem are you trying to solve with this security/code review check?

**A:** Custom review - check for unused things, inefficient ways of doing things, code cleanup. Security side: functionality stuff like making sure no one can just delete users or their picks by running network inspector or things like that. Users are not super technical but let's do basic defense against it.

---

## Question 2 - Users

**Q:** Who is this for?

**A:** For me to harden this project.

---

## Question 3 - Scope

**Q:** What level of completeness are you going for? (Quick audit, Full cleanup, Production-hardened)

**A:** Full cleanup - fix all identified issues, verify each fix works.

---

## Question 4 - Tech Stack

**Q:** Any specific tools or approaches you want me to use (or avoid) for this review?

**A:** Let's add some linting tools. Biome - something super lightweight.

---

## Question 5 - External Integrations

**Q:** Any specific concerns about particular endpoints, or should I audit all of them?

**A:** All of them - particularly the ones that can DDOS our app or violate our database integrity.

---

## Question 6 - Deployment

**Q:** Any changes to how this deploys?

**A:** No, as is.

---

## Question 7 - Done Criteria

**Summary presented:**

**Code Cleanup:**
- [ ] Biome installed and configured
- [ ] All unused code/imports removed
- [ ] Inefficient patterns identified and refactored
- [ ] Codebase passes Biome linting with no errors

**Security Hardening:**
- [ ] All API endpoints audited for abuse vectors
- [ ] Rate limiting added to prevent DoS
- [ ] Authorization checks on destructive operations (deletes, updates)
- [ ] Input validation on all user-supplied data

**Verification:**
- [ ] Docker build still works
- [ ] App functionality unchanged (manual smoke test)

**A:** Let's do it.

---

## Final Summary

- **Project:** HotStock (existing project)
- **Feature:** security-code-review
- **Scope:** Full cleanup - fix all issues, verify each fix
- **Tech:** Bun + Hono + SQLite + vanilla frontend (unchanged)
- **Deployment:** Docker (unchanged)
- **Tools to add:** Biome
