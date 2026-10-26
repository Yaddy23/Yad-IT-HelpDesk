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

  // Demo tickets (only when the ticket table is empty)
  const ticketCount = await prisma.ticket.count();
  if (ticketCount === 0) {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: '@demo.local' } },
      include: { employee: true },
    });
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const emp = byEmail.get('employee@demo.local')?.employee;
    const fin = byEmail.get('finance@demo.local')?.employee;
    const tech1 = byEmail.get('tech1@demo.local')?.employee;
    const tech1User = byEmail.get('tech1@demo.local');
    const adminUser = byEmail.get('admin@demo.local');

    if (emp && tech1 && tech1User && adminUser) {
      const demoTickets = [
        {
          number: 'INC-2026-000001',
          title: 'Laptop will not connect to Wi-Fi',
          description: 'Since this morning my laptop cannot see the office Wi-Fi network. Other devices work fine.',
          category: 'network',
          impact: 'medium' as const,
          urgency: 'high' as const,
          priority: 'high' as const,
          status: 'in_progress' as const,
          requesterId: emp.id,
          assigneeId: tech1.id,
          groupId: group.id,
        },
        {
          number: 'INC-2026-000002',
          title: 'Expense approval stuck in finance queue',
          description: 'An expense report has been pending approval for three days. Need it processed before the cut-off.',
          category: 'finance_system',
          impact: 'low' as const,
          urgency: 'medium' as const,
          priority: 'low' as const,
          status: 'new' as const,
          requesterId: (fin ?? emp).id,
          assigneeId: null,
          groupId: null,
        },
      ];
      for (const t of demoTickets) {
        await prisma.ticket.create({
          data: {
            ...t,
            activities: {
              create: { actorId: adminUser.id, action: 'created', detail: { seeded: true } },
            },
          },
        });
      }
      await prisma.ticketCounter.upsert({
        where: { key: 'INC' },
        update: { next: 3 },
        create: { key: 'INC', next: 3 },
      });
      console.log('   Seeded 2 demo tickets.');
    }
  }

  // Service catalog demo items (only when the catalog is empty)
  const catalogCount = await prisma.catalogItem.count();
  if (catalogCount === 0) {
    await prisma.catalogItem.create({
      data: {
        name: 'Password reset',
        description: 'Reset the password on your workstation or VPN account. No approval needed — handled by the service desk.',
        category: 'Account access',
        icon: 'key',
        sortOrder: 10,
        formSchema: [
          { name: 'accountType', label: 'Which account?', type: 'select', required: true, options: ['Workstation login', 'VPN', 'Email'] },
          { name: 'notes', label: 'Anything the service desk should know?', type: 'text', required: false },
        ] as never,
      },
    });

    const laptop = await prisma.catalogItem.create({
      data: {
        name: 'New laptop',
        description: 'Request a standard business laptop. Requires your manager’s approval.',
        category: 'Hardware',
        icon: 'laptop',
        sortOrder: 20,
        formSchema: [
          { name: 'device', label: 'Device type', type: 'select', required: true, options: ['Laptop 14"', 'Laptop 16"', 'Workstation'] },
          { name: 'justification', label: 'Business justification', type: 'textarea', required: true, help: 'Why do you need this equipment?' },
          { name: 'neededBy', label: 'Needed by', type: 'date', required: false },
        ] as never,
      },
    });
    await prisma.approvalRule.create({
      data: {
        name: 'Manager approval — laptops',
        catalogItemId: laptop.id,
        steps: [
          { name: 'Manager sign-off', mode: 'single', approver: { type: 'manager' }, deadlineHours: 48 },
        ] as never,
      },
    });

    const access = await prisma.catalogItem.create({
      data: {
        name: 'System access request',
        description: 'Request access to a business system. Needs your manager and then IT administration.',
        category: 'Account access',
        icon: 'shield',
        sortOrder: 30,
        formSchema: [
          { name: 'system', label: 'System', type: 'select', required: true, options: ['Finance system', 'CRM', 'HR portal', 'Data warehouse'] },
          { name: 'accessLevel', label: 'Access level', type: 'select', required: true, options: ['Read-only', 'Standard user', 'Power user'] },
          { name: 'justification', label: 'Business justification', type: 'textarea', required: true },
          { name: 'startDate', label: 'Access needed from', type: 'date', required: true },
        ] as never,
      },
    });
    await prisma.approvalRule.create({
      data: {
        name: 'Sequential — manager then IT admin',
        catalogItemId: access.id,
        steps: [
          { name: 'Manager sign-off', mode: 'single', approver: { type: 'manager' }, deadlineHours: 48 },
          { name: 'IT administration', mode: 'single', approver: { type: 'role', value: 'it_admin' }, deadlineHours: 72 },
        ] as never,
      },
    });

    console.log('   Seeded 3 catalog items (password reset, new laptop w/ manager approval, system access w/ 2-step approval).');
  }

  // Demo problems and known errors (only when empty)
  const problemCount = await prisma.problem.count();
  if (problemCount === 0) {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: '@demo.local' } },
      include: { employee: true },
    });
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const tech1 = byEmail.get('tech1@demo.local');
    const tech2 = byEmail.get('tech2@demo.local');
    const adminUser = byEmail.get('admin@demo.local');
    const manager = byEmail.get('manager@demo.local');
    const tech1User = byEmail.get('tech1@demo.local');

    // Incident links need real ticket rows — the demo tickets are seeded in
    // their own block, so they may be absent on a partial seed.
    const demoIncidents = await prisma.ticket.findMany({
      where: { number: { in: ['INC-2026-000001', 'INC-2026-000002'] } },
      select: { id: true, number: true },
    });
    const incidentId = new Map(demoIncidents.map((t) => [t.number, t.id]));

    if (tech1 && tech1User && tech2 && adminUser && manager) {
      // Problem 1: Network disconnections - RESOLVED with known error
      const problem1 = await prisma.problem.create({
        data: {
          number: 'PRB-2026-000001',
          title: 'Intermittent Wi-Fi disconnections on floor 3',
          description: 'Multiple users on floor 3 report Wi-Fi dropping 5-10 times per day. Started after firmware update on access points.',
          status: 'RESOLVED',
          priority: 'HIGH',
          ownerId: tech1.id,
          affectedServices: ['Network', 'Wi-Fi'],
          affectedAssets: ['AP-F3-01', 'AP-F3-02'],
          affectedCIs: ['NET-INFRA-001'],
          businessImpact: 'Productivity loss for ~50 employees on floor 3. Meetings disrupted, VPN drops during client calls.',
          rootCause: 'Faulty firmware v3.2.1 on Aruba AP-515 access points causes radio reset under high client density.',
          resolutionSummary: 'Rolled back APs to firmware v3.1.4. No disconnections reported in 14 days since rollback.',
          rcaType: 'FIVE_WHYS',
          fiveWhys: {
            steps: [
              { why: 'Why are users disconnecting?', answer: 'AP radio resets cause deauth of all clients' },
              { why: 'Why does the radio reset?', answer: 'Firmware v3.2.1 has a memory leak in the client management module' },
              { why: 'Why was this firmware deployed?', answer: 'Auto-update policy applied firmware during maintenance window' },
              { why: 'Why was the memory leak not caught in testing?', answer: 'Test environment had lower client density than production' },
              { why: 'Why no rollback plan?', answer: 'Change advisory did not require firmware rollback procedure' },
            ],
            rootCause: 'Faulty firmware v3.2.1 on Aruba AP-515 access points',
          },
          confirmedRootCause: true,
          workaround: 'Connect to wired Ethernet where available. Use 5GHz band only (less affected).',
          workaroundDocumentedAt: new Date('2026-10-10'),
          changeRequestIds: ['CHG-2026-000123'],
          changeInitiatedAt: new Date('2026-10-08'),
          resolvedAt: new Date('2026-10-15'),
          identifiedAt: new Date('2026-09-20'),
          investigationStartedAt: new Date('2026-09-22'),
          rootCauseIdentifiedAt: new Date('2026-10-05'),
          detectionSource: 'AUTO',
          autoDetectionScore: 87.5,
          auditLogs: {
            create: { actorId: adminUser.id, action: 'CREATED', newValue: { seeded: true } },
          },
          incidents: {
            create: [
              {
                incidentId: incidentId.get('INC-2026-000001') ?? '',
                linkedById: tech1.id,
                note: 'User reports match problem symptoms',
              },
            ].filter((link) => link.incidentId !== ''),
          },
        },
      });

      // Problem 2: VPN authentication failures - INVESTIGATION
      const problem2 = await prisma.problem.create({
        data: {
          number: 'PRB-2026-000002',
          title: 'VPN authentication fails for remote employees after password reset',
          description: 'Employees who reset their password via self-service portal cannot authenticate to VPN for up to 2 hours afterward. Error: "Invalid credentials" despite correct password.',
          status: 'INVESTIGATION',
          priority: 'CRITICAL',
          ownerId: tech2.id,
          affectedServices: ['VPN', 'Identity'],
          affectedAssets: ['VPN-GW-01'],
          affectedCIs: ['IDM-001'],
          businessImpact: 'Remote workers blocked from all corporate resources after password reset. ~20 tickets per week.',
          rcaType: 'NONE',
          detectionSource: 'MANUAL',
          autoDetectionScore: null,
          identifiedAt: new Date('2026-10-01'),
          investigationStartedAt: new Date('2026-10-03'),
          auditLogs: {
            create: { actorId: adminUser.id, action: 'CREATED', newValue: { seeded: true } },
          },
          incidents: {
            create: [
              {
                incidentId: incidentId.get('INC-2026-000002') ?? '',
                linkedById: tech2.id,
                note: 'Finance officer reported after password reset',
              },
            ].filter((link) => link.incidentId !== ''),
          },
        },
      });

      // Problem 3: Printer queue stalls - WORKAROUND_DOCUMENTED with known error
      const problem3 = await prisma.problem.create({
        data: {
          number: 'PRB-2026-000003',
          title: 'Network printer queue stalls on high-volume print jobs',
          description: 'Shared network printers (HP LaserJet MFP) stall when receiving print jobs over 50 pages. Queue shows "Processing" indefinitely. Requires power cycle to recover.',
          status: 'WORKAROUND_DOCUMENTED',
          priority: 'MEDIUM',
          ownerId: tech1.id,
          affectedServices: ['Printing'],
          affectedAssets: ['PRN-HP-MFP-01', 'PRN-HP-MFP-02', 'PRN-HP-MFP-03'],
          affectedCIs: ['PRINT-SVR-001'],
          businessImpact: 'Departments unable to print large documents. Workaround: split into smaller jobs.',
          rootCause: 'Printer firmware does not handle PCL6 jobs over 50MB correctly, causing spooler deadlock.',
          workaround: 'Submit large print jobs as PDF instead of PCL6. Or split jobs into batches under 50 pages.',
          workaroundDocumentedAt: new Date('2026-10-12'),
          rcaType: 'FISHBONE',
          fishbone: {
            categories: {
              People: ['Users not trained on job splitting'],
              Process: ['No job size validation in print driver'],
              Technology: ['Firmware bug in PCL6 parser'],
              Equipment: ['Aging printer fleet (5+ years)'],
              Environment: ['High concurrent print volume at month-end'],
              Other: ['Vendor firmware update delayed'],
            },
            rootCause: 'Printer firmware does not handle PCL6 jobs over 50MB correctly',
          },
          confirmedRootCause: true,
          detectionSource: 'AUTO',
          autoDetectionScore: 92.0,
          identifiedAt: new Date('2026-09-15'),
          investigationStartedAt: new Date('2026-09-18'),
          rootCauseIdentifiedAt: new Date('2026-10-01'),
          auditLogs: {
            create: { actorId: adminUser.id, action: 'CREATED', newValue: { seeded: true } },
          },
        },
      });

      // Problem 4: Email delivery delays - IDENTIFIED (new)
      const problem4 = await prisma.problem.create({
        data: {
          number: 'PRB-2026-000004',
          title: 'Outbound email delayed 10-30 minutes during peak hours',
          description: 'External emails sent between 9-11 AM and 2-4 PM experience 10-30 minute delivery delays. Internal mail flows normally.',
          status: 'IDENTIFIED',
          priority: 'HIGH',
          ownerId: manager.id,
          affectedServices: ['Email'],
          affectedAssets: ['EXCH-01', 'EXCH-02'],
          affectedCIs: ['MAIL-GW-001'],
          businessImpact: 'Time-sensitive external communications delayed. Client proposals, contracts affected.',
          rcaType: 'NONE',
          detectionSource: 'MANUAL',
          identifiedAt: new Date('2026-10-20'),
          auditLogs: {
            create: { actorId: adminUser.id, action: 'CREATED', newValue: { seeded: true } },
          },
        },
      });

      // Problem 5: Application crash on specific workflow - PENDING_CHANGE
      const problem5 = await prisma.problem.create({
        data: {
          number: 'PRB-2026-000005',
          title: 'Finance app crashes when generating quarterly reports with >10k rows',
          description: 'Finance application throws "OutOfMemoryError" when generating quarterly financial reports with more than 10,000 rows. Users must export to CSV and process externally.',
          status: 'PENDING_CHANGE',
          priority: 'HIGH',
          ownerId: tech2.id,
          affectedServices: ['Finance Application'],
          affectedAssets: ['APP-SRV-FIN-01'],
          affectedCIs: ['FIN-APP-001'],
          businessImpact: 'Quarterly reporting delayed by 2-3 days. Manual workaround error-prone.',
          rootCause: 'Report generation loads entire dataset into memory instead of streaming. Heap exhaustion at ~10k rows.',
          workaround: 'Export data to CSV and use Excel pivot tables for reporting.',
          workaroundDocumentedAt: new Date('2026-10-18'),
          rcaType: 'FIVE_WHYS',
          fiveWhys: {
            steps: [
              { why: 'Why does the app crash?', answer: 'Java heap space exhausted during report generation' },
              { why: 'Why is heap exhausted?', answer: 'Report engine loads all 10k+ rows into ArrayList before rendering' },
              { why: 'Why not streaming?', answer: 'Legacy JasperReports version does not support streaming export' },
              { why: 'Why not upgraded?', answer: 'Upgrade requires Java 17 migration; blocked by vendor compatibility' },
              { why: 'Why no workaround in app?', answer: 'Feature request logged with vendor; no ETA' },
            ],
            rootCause: 'Report generation loads entire dataset into memory instead of streaming',
          },
          confirmedRootCause: true,
          changeRequestIds: ['CHG-2026-000145'],
          changeInitiatedAt: new Date('2026-10-19'),
          detectionSource: 'MANUAL',
          identifiedAt: new Date('2026-10-05'),
          investigationStartedAt: new Date('2026-10-07'),
          rootCauseIdentifiedAt: new Date('2026-10-15'),
          auditLogs: {
            create: { actorId: adminUser.id, action: 'CREATED', newValue: { seeded: true } },
          },
        },
      });

      // Known Error 1: From Problem 1 (Network Wi-Fi)
      const knownError1 = await prisma.knownError.create({
        data: {
          number: 'KE-2026-000001',
          title: 'Wi-Fi disconnections from Aruba AP firmware v3.2.1',
          problemId: problem1.id,
          rootCause: 'Faulty firmware v3.2.1 on Aruba AP-515 access points causes radio reset under high client density.',
          symptoms: 'Intermittent Wi-Fi disconnections 5-10 times per day on floor 3. All clients on affected APs deauth simultaneously.',
          workaround: 'Roll back access points to firmware v3.1.4. Alternatively, use wired Ethernet or 5GHz band only.',
          resolutionNotes: 'Vendor acknowledged bug in v3.2.1 client management module. Fixed in v3.2.2 (not yet released).',
          ownerId: tech1.id,
          status: 'PUBLISHED',
          visibility: 'EMPLOYEE_SELF_SERVICE',
          affectedServices: ['Network', 'Wi-Fi'],
          affectedAssets: ['AP-F3-01', 'AP-F3-02'],
          affectedCIs: ['NET-INFRA-001'],
          approvedById: manager.id,
          approvedAt: new Date('2026-10-10'),
          lastReviewedAt: new Date('2026-10-15'),
          reviewDueAt: new Date('2027-01-13'),
        },
      });

      // Update problem1 with knownErrorId
      await prisma.problem.update({
        where: { id: problem1.id },
        data: { knownErrorId: knownError1.id },
      });

      // Known Error 2: From Problem 3 (Printer queue)
      const knownError2 = await prisma.knownError.create({
        data: {
          number: 'KE-2026-000002',
          title: 'HP LaserJet MFP queue stalls on large PCL6 print jobs',
          problemId: problem3.id,
          rootCause: 'Printer firmware does not handle PCL6 jobs over 50MB correctly, causing spooler deadlock.',
          symptoms: 'Print queue shows "Processing" indefinitely for jobs over 50 pages. Requires printer power cycle to recover.',
          workaround: 'Submit large print jobs as PDF instead of PCL6. Or split jobs into batches under 50 pages.',
          resolutionNotes: 'HP support confirmed firmware bug. Fixed in firmware 20261015 (not yet deployed to fleet).',
          ownerId: tech1.id,
          status: 'PUBLISHED',
          visibility: 'IT_ONLY',
          affectedServices: ['Printing'],
          affectedAssets: ['PRN-HP-MFP-01', 'PRN-HP-MFP-02', 'PRN-HP-MFP-03'],
          affectedCIs: ['PRINT-SVR-001'],
          approvedById: manager.id,
          approvedAt: new Date('2026-10-12'),
          lastReviewedAt: new Date('2026-10-18'),
          reviewDueAt: new Date('2027-01-16'),
        },
      });

      // Update problem3 with knownErrorId
      await prisma.problem.update({
        where: { id: problem3.id },
        data: { knownErrorId: knownError2.id },
      });

      // Known Error 3: DRAFT - VPN authentication (from Problem 2, still investigating)
      await prisma.knownError.create({
        data: {
          number: 'KE-2026-000003',
          title: 'VPN auth fails after password reset - IDM cache sync delay',
          problemId: problem2.id,
          rootCause: 'Identity management cache not invalidated on password reset, causing VPN to check stale credentials for up to 2 hours.',
          symptoms: 'VPN authentication fails with "Invalid credentials" for up to 2 hours after self-service password reset. Internal apps work immediately.',
          workaround: 'Wait 2 hours for cache sync, or contact IT to manually flush IDM cache.',
          resolutionNotes: 'Under investigation. Vendor patch IDM-2026-045 pending testing.',
          ownerId: tech2.id,
          status: 'DRAFT',
          visibility: 'IT_ONLY',
          affectedServices: ['VPN', 'Identity'],
          affectedAssets: ['VPN-GW-01'],
          affectedCIs: ['IDM-001'],
        },
      });

      // Known Error 4: UNDER_REVIEW - Email delays
      await prisma.knownError.create({
        data: {
          number: 'KE-2026-000004',
          title: 'Outbound email queue backlog during peak hours',
          problemId: problem4.id,
          rootCause: 'Exchange transport queue throttling triggered by high message volume during 9-11 AM and 2-4 PM windows.',
          symptoms: 'External emails delayed 10-30 minutes during peak hours. Internal mail unaffected. Queue viewer shows 500+ messages pending.',
          workaround: 'Schedule bulk sends outside peak hours. Use high-priority flag for time-sensitive mail.',
          resolutionNotes: 'Planning transport rule adjustment and queue threshold increase. Change request CHG-2026-000156 in approval.',
          ownerId: manager.id,
          status: 'UNDER_REVIEW',
          visibility: 'IT_ONLY',
          affectedServices: ['Email'],
          affectedAssets: ['EXCH-01', 'EXCH-02'],
          affectedCIs: ['MAIL-GW-001'],
        },
      });

      // Update problem counters
      await prisma.problemCounter.upsert({
        where: { key: 'PRB' },
        update: { next: 6 },
        create: { key: 'PRB', next: 6 },
      });
      await prisma.knownErrorCounter.upsert({
        where: { key: 'KE' },
        update: { next: 5 },
        create: { key: 'KE', next: 5 },
      });

      console.log('   Seeded 5 demo problems and 4 known errors.');
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
