type TemplateRecipient = {
  email: string;
  name: string | null;
};

export function renderRecipientTemplate(template: string, recipient: TemplateRecipient) {
  const firstName = recipient.name?.trim() || recipient.email;

  return template
    .replaceAll("{{email}}", recipient.email)
    .replaceAll("{{firstName}}", firstName)
    .replaceAll("{{name}}", firstName);
}
