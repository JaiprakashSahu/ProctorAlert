import { StudentPortal } from './student';
import { TeacherDashboard } from './teacher';

type Route = 'home' | 'student' | 'teacher';

class App {
    private currentPage: StudentPortal | TeacherDashboard | null = null;

    constructor() {
        this.render();
        this.handleNavigation();
        window.addEventListener('popstate', () => this.handleNavigation());
    }

    private render(): void {
        const app = document.getElementById('app');
        if (!app) return;

        app.innerHTML = `
      <nav class="nav">
        <a class="nav-brand" data-route="home">
          <div class="nav-brand-icon"></div>
          SmartSession
        </a>
        <div class="nav-links">
          <a class="nav-link" data-route="student">Student Portal</a>
          <a class="nav-link" data-route="teacher">Teacher Dashboard</a>
        </div>
      </nav>
      <main id="main-content" class="main-content"></main>
    `;

        document.querySelectorAll('[data-route]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const route = (el as HTMLElement).dataset.route as Route;
                this.navigate(route);
            });
        });
    }

    private navigate(route: Route): void {
        const paths: Record<Route, string> = {
            home: '/',
            student: '/student',
            teacher: '/teacher'
        };
        history.pushState(null, '', paths[route]);
        this.handleNavigation();
    }

    private handleNavigation(): void {
        const path = window.location.pathname;
        let route: Route = 'home';

        if (path === '/student') route = 'student';
        else if (path === '/teacher') route = 'teacher';

        this.updateActiveNav(route);
        this.renderPage(route);
    }

    private updateActiveNav(route: Route): void {
        document.querySelectorAll('.nav-link').forEach(el => {
            const linkRoute = (el as HTMLElement).dataset.route;
            el.classList.toggle('active', linkRoute === route);
        });
    }

    private renderPage(route: Route): void {
        if (this.currentPage) {
            this.currentPage.destroy();
            this.currentPage = null;
        }

        const content = document.getElementById('main-content');
        if (!content) return;

        switch (route) {
            case 'home':
                this.renderHome(content);
                break;
            case 'student':
                this.currentPage = new StudentPortal(content);
                break;
            case 'teacher':
                this.currentPage = new TeacherDashboard(content);
                break;
        }
    }

    private renderHome(container: HTMLElement): void {
        container.innerHTML = `
      <div class="home-container">
        <h1 class="home-title">SmartSession</h1>
        <p class="home-description">
          Real-time student engagement monitoring with transparent, rule-based computer vision analysis.
        </p>
        <div class="home-actions">
          <button class="btn btn-primary" data-route="student">Join as Student</button>
          <button class="btn btn-primary" data-route="teacher">Open Teacher Dashboard</button>
        </div>
      </div>
    `;

        container.querySelectorAll('[data-route]').forEach(el => {
            el.addEventListener('click', () => {
                this.navigate((el as HTMLElement).dataset.route as Route);
            });
        });
    }
}

new App();
