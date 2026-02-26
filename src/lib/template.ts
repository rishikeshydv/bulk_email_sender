type TemplateRecipient = {
  email: string;
  name: string | null;
};

export function renderRecipientTemplate(template: string, recipient: TemplateRecipient) {
  return template
    .replaceAll("{{email}}", recipient.email)
    .replaceAll("{{name}}", recipient.name?.trim() || recipient.email);
}
