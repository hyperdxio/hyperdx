export const validatePassword = (password: string) => {
  if (!password || password.length < 8 || password.length > 64) {
    return false;
  }
  return true;
};
