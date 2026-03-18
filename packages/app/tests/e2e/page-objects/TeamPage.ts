/**
 * TeamPage - Page object for the /team settings page
 * Encapsulates all interactions with team settings sections:
 * Sources, Connections, Integrations/Webhooks, Team Name,
 * ClickHouse Settings, API Keys, and Team Members.
 */
import { Locator, Page } from '@playwright/test';

export class TeamPage {
  readonly page: Page;

  private readonly pageContainer: Locator;
  private readonly dataTabButton: Locator;
  private readonly teamTabButton: Locator;
  private readonly accessTabButton: Locator;
  private readonly integrationsTabButton: Locator;
  private readonly advancedTabButton: Locator;

  // Section containers
  private readonly sourcesSection: Locator;
  private readonly connectionsSection: Locator;
  private readonly integrationsSection: Locator;
  private readonly teamNameSection: Locator;
  private readonly apiKeysSection: Locator;
  private readonly teamMembersSection: Locator;
  private readonly securityPoliciesHeading: Locator;
  private readonly querySettingsHeading: Locator;

  // Team name elements
  private readonly teamNameDisplay: Locator;
  private readonly teamNameChangeButton: Locator;
  private readonly teamNameInput: Locator;
  private readonly teamNameSaveButton: Locator;
  private readonly teamNameCancelButton: Locator;

  // API Keys elements
  private readonly rotateApiKeyButton: Locator;
  private readonly rotateApiKeyConfirm: Locator;
  private readonly rotateApiKeyCancel: Locator;

  // Connections elements
  private readonly addConnectionButton: Locator;

  // Webhooks elements
  private readonly addWebhookButton: Locator;
  private readonly webhooksEmptyState: Locator;

  // Team members elements
  private readonly inviteMemberButton: Locator;
  private readonly inviteEmailInput: Locator;
  private readonly sendInviteButton: Locator;
  private readonly confirmDeleteMemberButton: Locator;
  private readonly cancelDeleteMemberButton: Locator;
  private readonly confirmDialogConfirmBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageContainer = page.getByTestId('team-page');
    this.dataTabButton = page.getByRole('tab', { name: 'Data', exact: true });
    this.teamTabButton = page.getByRole('tab', {
      name: 'Members',
      exact: true,
    });
    this.accessTabButton = page.getByRole('tab', {
      name: 'Access',
      exact: true,
    });
    this.integrationsTabButton = page.getByRole('tab', {
      name: 'Integrations',
      exact: true,
    });
    this.advancedTabButton = page.getByRole('tab', {
      name: 'Query Settings',
      exact: true,
    });

    this.sourcesSection = page.getByTestId('sources-section');
    this.connectionsSection = page.getByTestId('connections-section');
    this.integrationsSection = page.getByTestId('integrations-section');
    this.teamNameSection = page.getByTestId('team-name-section');
    this.apiKeysSection = page.getByTestId('api-keys-section');
    this.teamMembersSection = page.getByTestId('team-members-section');
    this.securityPoliciesHeading = page.getByText('Security Policies', {
      exact: true,
    });
    this.querySettingsHeading = page.getByText('ClickHouse Client Settings', {
      exact: true,
    });

    this.teamNameDisplay = page.getByTestId('team-name-display');
    this.teamNameChangeButton = page.getByTestId('team-name-change-button');
    this.teamNameInput = page.getByTestId('team-name-input');
    this.teamNameSaveButton = page.getByTestId('team-name-save-button');
    this.teamNameCancelButton = page.getByTestId('team-name-cancel-button');

    this.rotateApiKeyButton = page.getByTestId('rotate-api-key-button');
    this.rotateApiKeyConfirm = page.getByTestId('rotate-api-key-confirm');
    this.rotateApiKeyCancel = page.getByTestId('rotate-api-key-cancel');

    this.addConnectionButton = page.getByTestId('add-connection-button');

    this.addWebhookButton = page.getByTestId('add-webhook-section-button');
    this.webhooksEmptyState = page.getByTestId('webhooks-empty-state');

    this.inviteMemberButton = page.getByTestId('invite-member-button');
    this.inviteEmailInput = page.getByTestId('invite-email-input');
    this.sendInviteButton = page.getByTestId('send-invite-button');
    this.confirmDeleteMemberButton = page.getByTestId('confirm-delete-member');
    this.cancelDeleteMemberButton = page.getByTestId('cancel-delete-member');
    this.confirmDialogConfirmBtn = page.getByTestId('confirm-confirm-button');
  }

  async goto() {
    await this.page.goto('/team');
    await this.pageContainer.waitFor({ state: 'visible', timeout: 10000 });
  }

  private async openTab(tab: Locator, section: Locator) {
    await tab.click();
    await section.waitFor({ state: 'visible' });
  }

  async openDataTab() {
    await this.openTab(this.dataTabButton, this.sourcesSection);
  }

  async openTeamTab() {
    await this.openTab(this.teamTabButton, this.teamNameSection);
  }

  async openIntegrationsTab() {
    await this.openTab(this.integrationsTabButton, this.integrationsSection);
  }

  async openAdvancedTab() {
    await this.openTab(this.advancedTabButton, this.querySettingsHeading);
  }

  async openAccessTab() {
    await this.openTab(this.accessTabButton, this.securityPoliciesHeading);
  }

  async hasAccessTab() {
    return this.accessTabButton.isVisible();
  }

  // --- Team Name ---

  async getTeamNameText() {
    return this.teamNameDisplay.textContent();
  }

  async startEditingTeamName() {
    await this.teamNameChangeButton.click();
    await this.teamNameInput.waitFor({ state: 'visible' });
  }

  async fillTeamName(name: string) {
    await this.teamNameInput.clear();
    await this.teamNameInput.fill(name);
  }

  async saveTeamName() {
    await this.teamNameSaveButton.click();
  }

  async cancelEditingTeamName() {
    await this.teamNameCancelButton.click();
  }

  async changeTeamName(name: string) {
    await this.startEditingTeamName();
    await this.fillTeamName(name);
    await this.saveTeamName();
  }

  // --- API Keys ---

  async clickRotateApiKey() {
    await this.rotateApiKeyButton.click();
  }

  async confirmRotateApiKey() {
    await this.rotateApiKeyConfirm.click();
  }

  async cancelRotateApiKey() {
    await this.rotateApiKeyCancel.click();
  }

  // --- Connections ---

  async clickAddConnection() {
    await this.addConnectionButton.click();
  }

  async fillConnectionForm(opts: {
    name: string;
    host: string;
    username: string;
    password: string;
  }) {
    await this.page.getByTestId('connection-name-input').clear();
    await this.page.getByTestId('connection-name-input').fill(opts.name);
    await this.page.getByTestId('connection-host-input').clear();
    await this.page.getByTestId('connection-host-input').fill(opts.host);
    await this.page.getByTestId('connection-username-input').clear();
    await this.page
      .getByTestId('connection-username-input')
      .fill(opts.username);
    await this.page.getByTestId('update-password-button').click();
    await this.page
      .getByTestId('connection-password-input')
      .fill(opts.password);
  }

  async saveConnection() {
    await this.page.getByTestId('connection-save-button').click();
  }

  // --- Webhooks ---

  async clickAddWebhook() {
    await this.addWebhookButton.click();
  }

  async fillWebhookForm(opts: {
    serviceType: 'Slack' | 'incident.io' | 'Generic';
    name: string;
    url: string;
  }) {
    await this.page
      .getByTestId('service-type-radio-group')
      .getByRole('radio', { name: opts.serviceType, exact: true })
      .click();
    await this.page.getByTestId('webhook-name-input').fill(opts.name);
    await this.page.getByTestId('webhook-url-input').fill(opts.url);
  }

  async submitWebhookForm() {
    await this.page.getByTestId('add-webhook-button').click();
  }

  async createWebhook(opts: {
    serviceType: 'Slack' | 'incident.io' | 'Generic';
    name: string;
    url: string;
  }) {
    await this.clickAddWebhook();
    await this.fillWebhookForm(opts);
    await this.submitWebhookForm();
  }

  // --- Team Members ---

  async clickInviteMember() {
    await this.inviteMemberButton.click();
  }

  async fillInviteEmail(email: string) {
    await this.inviteEmailInput.fill(email);
  }

  async submitInvite() {
    await this.sendInviteButton.click();
  }

  async inviteTeamMember(email: string) {
    await this.clickInviteMember();
    await this.fillInviteEmail(email);
    await this.submitInvite();
  }

  async confirmDeleteMember() {
    await this.confirmDeleteMemberButton.click();
  }

  async cancelDeleteMember() {
    await this.cancelDeleteMemberButton.click();
  }

  getInvitationRow(email: string) {
    return this.teamMembersSection.locator('tr').filter({ hasText: email });
  }

  async deleteInvitationByEmail(email: string) {
    await this.getInvitationRow(email)
      .getByRole('button', { name: 'Delete' })
      .click();
  }

  async deleteWebhookByName(webhookName: string) {
    const webhookItem = this.integrationsSection
      .locator('div')
      .filter({ hasText: webhookName })
      .filter({ has: this.page.getByRole('button', { name: 'Delete' }) })
      .last();
    await webhookItem.getByRole('button', { name: 'Delete' }).click();
  }

  async confirmDialog() {
    await this.confirmDialogConfirmBtn.click();
  }

  // --- Getters for assertions ---

  get container() {
    return this.pageContainer;
  }

  get dataTab() {
    return this.dataTabButton;
  }

  get teamTab() {
    return this.teamTabButton;
  }

  get accessTab() {
    return this.accessTabButton;
  }

  get integrationsTab() {
    return this.integrationsTabButton;
  }

  get advancedTab() {
    return this.advancedTabButton;
  }

  get sources() {
    return this.sourcesSection;
  }

  get connections() {
    return this.connectionsSection;
  }

  get integrations() {
    return this.integrationsSection;
  }

  get teamName() {
    return this.teamNameSection;
  }

  get teamNameValue() {
    return this.teamNameDisplay;
  }

  get teamNameEditButton() {
    return this.teamNameChangeButton;
  }

  get teamNameSave() {
    return this.teamNameSaveButton;
  }

  get teamNameCancel() {
    return this.teamNameCancelButton;
  }

  get apiKeys() {
    return this.apiKeysSection;
  }

  get rotateButton() {
    return this.rotateApiKeyButton;
  }

  get members() {
    return this.teamMembersSection;
  }

  get inviteButton() {
    return this.inviteMemberButton;
  }

  get webhooksEmpty() {
    return this.webhooksEmptyState;
  }

  get addWebhook() {
    return this.addWebhookButton;
  }

  get addConnection() {
    return this.addConnectionButton;
  }

  get securityPolicies() {
    return this.securityPoliciesHeading;
  }

  get querySettings() {
    return this.querySettingsHeading;
  }

  get connectionForm() {
    return this.page.getByTestId('connection-form');
  }

  get webhookNameInput() {
    return this.page.getByTestId('webhook-name-input');
  }

  get webhookUrlInput() {
    return this.page.getByTestId('webhook-url-input');
  }
}
