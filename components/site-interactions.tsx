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
      contactForm?.removeEventListener("submit", onContactSubmit);
      authHandlers.forEach((handler, form) => form.removeEventListener("submit", handler));
      recovery?.removeEventListener("click", onRecovery);
    };
  }, []);

  return null;
}
