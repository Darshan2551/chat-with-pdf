const getEnv = (key: string) => {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const getServerEnv = () => ({
  databaseUrl: getEnv("DATABASE_URL"),
  clerkSecretKey: getEnv("CLERK_SECRET_KEY"),
  clerkPublishableKey: getEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  geminiApiKey: getEnv("GEMINI_API_KEY"),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || "15"),
});
