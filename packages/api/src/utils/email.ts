export const sendAlert = ({
  alertDetails,
  alertEvents,
  alertGroup,
  alertName,
  alertUrl,
  toEmail,
}: {
  alertDetails: string;
  alertEvents: string;
  alertGroup?: string;
  alertName: string;
  alertUrl: string;
  toEmail: string;
}) => {
  // Send alert email
};

export const sendResetPasswordEmail = ({
  toEmail,
  token,
}: {
  toEmail: string;
  token: string;
}) => {
  // Send reset password email
};
