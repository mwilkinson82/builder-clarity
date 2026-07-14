/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ComponentType } from "react";

export interface TemplateEntry {
  component: ComponentType<any>;
  subject: string | ((data: Record<string, any>) => string);
  displayName?: string;
  previewData?: Record<string, any>;
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string;
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
import { template as invoiceNotification } from "./invoice-notification";
import { template as iorReportNotification } from "./ior-report-notification";
import { template as loginNotification } from "./login-notification";
import { template as selectionNotification } from "./selection-notification";

export const TEMPLATES: Record<string, TemplateEntry> = {
  "login-notification": loginNotification,
  "invoice-notification": invoiceNotification,
  "ior-report-notification": iorReportNotification,
  "selection-notification": selectionNotification,
};
