/**
 * Demo seed — every record created here is DEMO DATA, clearly labeled.
 * Run: npm run db:seed -w server
 *
 * Creates: default business calendar, system settings, departments, locations,
 * an assignment group, and demo users for every role (emails @demo.local,
 * password ChangeMe!2026 — must be changed before any real use).
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/core/password.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'ChangeMe!2026';

async function main() {
  console.log('🌱 Seeding demo organization (all records are demo data)...');

  // System settings (singleton)
  await prisma.systemSettings.upsert({
    where: { key: 'global' },
    update: {},
    create: {
      key: 'global',
      priorityMatrix: {
        high: { high: 'critical', medium: 'high', low: 'medium' },
        medium: { high: 'high', medium: 'medium', low: 'low' },
        low: { high: 'medium', medium: 'low', low: 'low' },
      } as never,
      slaPauseStates: ['pending_employee', 'pending_vendor'],
    },
  });

  // Default business calendar (Mon–Fri 09:00–17:00 UTC)
  const calendar = await prisma.businessCalendar.findFirst({ where: { isDefault: true } });
  const defaultCalendar =
    calendar ??
    (await prisma.businessCalendar.create({
      data: {
        name: 'Default Business Hours',
        timezone: 'UTC',
        isDefault: true,
        workWindows: {
          create: (['mon', 'tue', 'wed', 'thu', 'fri'] as const).map((day) => ({
            day,
            start: '09:00',
            end: '17:00',
          })),
        },
        holidays: {
          create: [
            { date: new Date('2027-01-01'), name: "New Year's Day" },
            { date: new Date('2027-12-25'), name: 'Christmas Day' },
          ],
        },
      },
    }));

  // Locations
  const locHq = await prisma.location.upsert({
    where: { code: 'HQ' },
    update: {},
    create: { name: 'Headquarters', code: 'HQ', timezone: 'UTC', address: '1 Main Street' },
  });
  const locBranch = await prisma.location.upsert({
    where: { code: 'BRANCH-EAST' },
    update: {},
    create: { name: 'East Branch Office', code: 'BRANCH-EAST', timezone: 'UTC' },
  });

  // Assignment group (created before departments so departments can reference it)
  const group = await prisma.assignmentGroup.upsert({
    where: { code: 'IT-SUPPORT' },
    update: {},
    create: { name: 'IT Support', code: 'IT-SUPPORT', description: 'Tier 1/2 service desk' },
  });

  // Departments
  const deptIt = await prisma.department.upsert({
    where: { code: 'IT' },
    update: {},
    create: {
      name: 'Information Technology',
      code: 'IT',
      supportGroupId: group.id,
      officeLocationId: locHq.id,
    },
  });
  const deptHr = await prisma.department.upsert({
    where: { code: 'HR' },
    update: {},
    create: { name: 'Human Resources', code: 'HR', officeLocationId: locHq.id },
  });
  const deptFin = await prisma.department.upsert({
    where: { code: 'FIN' },
    update: {},
    create: { name: 'Finance', code: 'FIN', officeLocationId: locBranch.id },
  });

  // Demo users for every role
  const demoUsers: {
    email: string;
    name: string;
    roles: ('super_admin' | 'it_admin' | 'it_manager' | 'it_technician' | 'employee' | 'approver')[];
    jobTitle: string;
    departmentId: string;
    locationId: string;
    managerEmail?: string;
  }[] = [
    { email: 'admin@demo.local', name: 'Demo Admin', roles: ['super_admin'], jobTitle: 'IT Director', departmentId: deptIt.id, locationId: locHq.id },
    { email: 'it.admin@demo.local', name: 'Demo IT Admin', roles: ['it_admin'], jobTitle: 'System Administrator', departmentId: deptIt.id, locationId: locHq.id },
    { email: 'manager@demo.local', name: 'Demo IT Manager', roles: ['it_manager'], jobTitle: 'IT Service Manager', departmentId: deptIt.id, locationId: locHq.id },
    { email: 'tech1@demo.local', name: 'Demo Technician One', roles: ['it_technician'], jobTitle: 'Support Technician', departmentId: deptIt.id, locationId: locHq.id },
    { email: 'tech2@demo.local', name: 'Demo Technician Two', roles: ['it_technician'], jobTitle: 'Field Technician', departmentId: deptIt.id, locationId: locBranch.id },
    { email: 'employee@demo.local', name: 'Demo Employee', roles: ['employee'], jobTitle: 'HR Coordinator', departmentId: deptHr.id, locationId: locHq.id, managerEmail: 'manager@demo.local' },
    { email: 'finance@demo.local', name: 'Demo Finance Officer', roles: ['employee', 'approver'], jobTitle: 'Finance Officer', departmentId: deptFin.id, locationId: locBranch.id, managerEmail: 'manager@demo.local' },
  ];

  const employeeCount = await prisma.employee.count();
  let seq = employeeCount;
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const u of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        roles: { create: u.roles.map((role) => ({ role })) },
        employee: {
          create: {
            employeeId: `EMP-${String(++seq).padStart(6, '0')}`,
            name: u.name,
            email: u.email,
            jobTitle: u.jobTitle,
            departmentId: u.departmentId,
            locationId: u.locationId,
          },
        },
      },
      include: { employee: true },
    });
    if (u.managerEmail) {
      const mgr = await prisma.user.findUnique({ where: { email: u.managerEmail }, include: { employee: true } });
      if (mgr?.employee) {
        await prisma.employee.update({ where: { id: user.employee!.id }, data: { managerId: mgr.employee.id } });
      }
    }
  }

  // Dedupe group memberships: ensure each tech/manager has exactly one active membership
  const itUsers = await prisma.user.findMany({
    where: { roles: { some: { role: { in: ['it_technician', 'it_manager'] } } } },
    select: { id: true },
  });
  for (const u of itUsers) {
    const existing = await prisma.assignmentGroupMember.findFirst({
      where: { groupId: group.id, userId: u.id, leftAt: null },
    });
    if (!existing) {
      await prisma.assignmentGroupMember.create({ data: { groupId: group.id, userId: u.id } });
    }
  }

  console.log('✅ Seed complete. DEMO accounts (password: %s):', DEMO_PASSWORD);
  for (const u of demoUsers) console.log(`   - ${u.email}  (${u.roles.join(', ')})`);
  console.log('   Default calendar:', defaultCalendar.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
