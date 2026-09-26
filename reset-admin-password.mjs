import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const EMAIL = 'danielbirtas1911@gmail.com';
const NEW_PASSWORD = 'Kimono2026!Admin';
const SALT_ROUNDS = 12;

async function main() {
  const hash = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS);

  const user = await prisma.user.update({
    where: { email: EMAIL },
    data: {
      passwordHash: hash,
      emailVerified: true,
    },
  });

  console.log('Parola resetata cu succes!');
  console.log('Email:', user.email);
  console.log('Parola:', NEW_PASSWORD);
  console.log('Email verificat:', user.emailVerified);
}

main()
  .catch((e) => {
    console.error('Eroare:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
