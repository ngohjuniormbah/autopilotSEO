"use client";

import { useEffect } from "react";

export default function SiteInteractions() {
  useEffect(() => {
    const menu = document.querySelector<HTMLButtonElement>(".menu-toggle");
    const navLinks = document.querySelector<HTMLElement>(".nav-links");
    const onMenuClick = () => {
      if (!menu || !navLinks) return;
      const isOpen = menu.getAttribute("aria-expanded") === "true";
      menu.setAttribute("aria-expanded", String(!isOpen));
      menu.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
      navLinks.classList.toggle("open", !isOpen);
    };
    const onNavClick = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest("a")) return;
      menu?.setAttribute("aria-expanded", "false");
      menu?.setAttribute("aria-label", "Open navigation");
      navLinks?.classList.remove("open");
    };
    menu?.addEventListener("click", onMenuClick);
    navLinks?.addEventListener("click", onNavClick);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const phrases = [
      "Rank on Google.",
      "Be recommended by ChatGPT.",
      "Get discovered on Perplexity.",
      "Turn search visibility into customers.",
    ];
    const rotator = document.getElementById("rotating-text");
    let phraseIndex = 0;
    let phraseTimer: number | undefined;
    let phraseSwap: number | undefined;
    if (rotator && !reduceMotion) {
      phraseTimer = window.setInterval(() => {
        rotator.classList.add("out");
        phraseSwap = window.setTimeout(() => {
          phraseIndex = (phraseIndex + 1) % phrases.length;
          rotator.textContent = phrases[phraseIndex];
          rotator.classList.remove("out");
        }, 240);
      }, 3000);
    }

    const revealElements = document.querySelectorAll<HTMLElement>(".reveal");
    let observer: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window && !reduceMotion) {
      observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("visible");
            observer?.unobserve(entry.target);
          }),
        { threshold: 0.12 },
      );
      revealElements.forEach((element) => {
        element.classList.add("animate-ready");
        observer?.observe(element);
      });
    } else {
      revealElements.forEach((element) => element.classList.add("visible"));
    }

    const workflow = document.querySelector<HTMLElement>(".workflow-demo");
    const workflowTabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-workflow-step]"),
    );
    const workflowContent = [
      {
        kicker: "SITE SCAN",
        title: "Finding the pages that matter.",
        task: "Crawling website pages",
        copy: "Checking titles, links, indexability and page structure",
        state: "Scanning",
        finding: "4 pages are missing descriptions",
        detail: "A clear description can help searchers understand each page.",
        suggestion: "Draft page-specific descriptions",
        footer: "No changes made",
        status: "Crawling important pages",
      },
      {
        kicker: "OPPORTUNITY FOUND",
        title: "Focus on a useful, fixable issue.",
        task: "Prioritizing SEO opportunities",
        copy: "Comparing potential impact, confidence and effort",
        state: "Prioritized",
        finding: "4 service pages lack descriptions",
        detail: "These pages already receive impressions in search.",
        suggestion: "Start with your highest-traffic service page",
        footer: "Recommendation ready",
        status: "Ranking opportunities by impact and effort",
      },
      {
        kicker: "REVIEW BEFORE CHANGES",
        title: "You stay in control of every fix.",
        task: "Preparing a change for review",
        copy: "Previewing a page-specific description before publishing",
        state: "Awaiting review",
        finding: "Suggested description is ready to review",
        detail: "Check the wording and confirm it accurately describes your service.",
        suggestion: "Approve or edit the proposed description",
        footer: "Nothing published without approval",
        status: "Reviewing a sample change before it goes live",
      },
      {
        kicker: "VERIFY THE OUTCOME",
        title: "Check that the improvement is live.",
        task: "Validating the updated page",
        copy: "Rechecking the page and recording the completed action",
        state: "Verified",
        finding: "Updated description is present on the page",
        detail: "Continue monitoring search data as it becomes available.",
        suggestion: "Track clicks and impressions over time",
        footer: "Example workflow complete",
        status: "Verifying the change and tracking future performance",
      },
    ];
    let workflowIndex = 0;
    let workflowTimer: number | undefined;
    let workflowObserver: IntersectionObserver | undefined;
    let workflowInView = false;
    const renderWorkflow = (index: number) => {
      workflowIndex = (index + workflowContent.length) % workflowContent.length;
      const item = workflowContent[workflowIndex];
      workflow?.setAttribute("data-workflow", String(workflowIndex));
      workflowTabs.forEach((tab, tabIndex) => {
        const active = tabIndex === workflowIndex;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      const values: Record<string, string> = {
        "workflow-kicker": item.kicker,
        "workflow-title": item.title,
        "workflow-count": `0${workflowIndex + 1} / 04`,
        "workflow-task-title": item.task,
        "workflow-task-copy": item.copy,
        "workflow-task-state": item.state,
        "workflow-result-title": item.finding,
        "workflow-result-copy": item.detail,
        "workflow-suggestion": item.suggestion,
        "workflow-footer-state": item.footer,
      };
      Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      });
      const status = workflow?.querySelector<HTMLElement>(".workflow-status");
      if (status) status.textContent = `Step ${workflowIndex + 1} of 4 · ${item.status}`;
      workflow?.querySelector<HTMLElement>(".workflow-progress i")?.style.setProperty(
        "width",
        `${(workflowIndex + 1) * 25}%`,
      );
    };
    const stopWorkflow = () => {
      if (workflowTimer) window.clearInterval(workflowTimer);
      workflowTimer = undefined;
    };
    const startWorkflow = () => {
      stopWorkflow();
      if (reduceMotion || !workflowInView || document.hidden) return;
      workflowTimer = window.setInterval(() => renderWorkflow(workflowIndex + 1), 4200);
    };
    const onWorkflowTabClick = (event: Event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const index = Number(target.dataset.workflowStep);
      if (Number.isInteger(index)) renderWorkflow(index);
      startWorkflow();
    };
    workflowTabs.forEach((tab) => tab.addEventListener("click", onWorkflowTabClick));
    if (workflow && "IntersectionObserver" in window && !reduceMotion) {
      workflowObserver = new IntersectionObserver(([entry]) => {
        workflowInView = Boolean(entry?.isIntersecting);
        if (workflowInView) startWorkflow();
        else stopWorkflow();
      }, { threshold: 0.3 });
      workflowObserver.observe(workflow);
    }
    const onVisibilityChange = () => (document.hidden ? stopWorkflow() : startWorkflow());
    document.addEventListener("visibilitychange", onVisibilityChange);

    const contactForm = document.getElementById("contact-form") as HTMLFormElement | null;
    const onContactSubmit = (event: Event) => {
      event.preventDefault();
      if (!contactForm) return;
      const status = contactForm.querySelector<HTMLElement>(".form-status");
      const validators: Record<string, (value: string) => string> = {
        name: (value) => (value.trim().length >= 2 ? "" : "Please enter your name."),
        email: (value) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? "" : "Enter a valid business email.",
        website: (value) =>
          !value.trim() || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(value.trim())
            ? ""
            : "Enter a full URL, such as https://example.com.",
        message: (value) =>
          value.trim().length >= 10 ? "" : "Please add a little more detail (at least 10 characters).",
      };
      const inputs = Array.from(contactForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
      let valid = true;
      for (const input of inputs) {
        const error = validators[input.name]?.(input.value) ?? "";
        input.setAttribute("aria-invalid", String(Boolean(error)));
        const message = input.parentElement?.querySelector<HTMLElement>(".field-error");
        if (message) message.textContent = error;
        if (error) valid = false;
      }
      if (!valid) {
        if (status) {
          status.textContent = "Check the highlighted fields and try again.";
          status.style.color = "#bd4141";
        }
        contactForm.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        return;
      }
      const button = contactForm.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!button) return;
      button.disabled = true;
      button.textContent = "Checking form…";
      if (status) {
        status.style.color = "#788391";
        status.textContent =
          "Your details are valid. This demo site has no contact service connected, so nothing has been sent.";
      }
      window.setTimeout(() => {
        button.disabled = false;
        button.innerHTML = 'Send enquiry <span aria-hidden="true">↗</span>';
      }, 600);
    };
    contactForm?.addEventListener("submit", onContactSubmit);

    const authForms = document.querySelectorAll<HTMLFormElement>("[data-auth-form]");
    const authHandlers = new Map<HTMLFormElement, (event: Event) => void>();
    authForms.forEach((form) => {
      const handler = (event: Event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const message = form.querySelector<HTMLElement>(".auth-message");
        if (message)
          message.textContent =
            "Your details are valid, but authentication is not connected on this demo site.";
      };
      authHandlers.set(form, handler);
      form.addEventListener("submit", handler);
    });
    const recovery = document.querySelector<HTMLElement>("[data-recovery]");
    const onRecovery = (event: Event) => {
      event.preventDefault();
      const message = document.querySelector<HTMLElement>(".auth-message");
      if (message)
        message.textContent = "Account recovery will be available when authentication is connected.";
    };
    recovery?.addEventListener("click", onRecovery);

    return () => {
      menu?.removeEventListener("click", onMenuClick);
      navLinks?.removeEventListener("click", onNavClick);
      if (phraseTimer) window.clearInterval(phraseTimer);
      if (phraseSwap) window.clearTimeout(phraseSwap);
      observer?.disconnect();
      workflowObserver?.disconnect();
      stopWorkflow();
      workflowTabs.forEach((tab) => tab.removeEventListener("click", onWorkflowTabClick));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      contactForm?.removeEventListener("submit", onContactSubmit);
      authHandlers.forEach((handler, form) => form.removeEventListener("submit", handler));
      recovery?.removeEventListener("click", onRecovery);
    };
  }, []);

  return null;
}
