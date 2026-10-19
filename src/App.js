import './App.css';
import { NavBar } from './other_assets/NavBar/nav_bar';
import { AllGamesPage } from './other_assets/all_game_page/all_game_page';
import { BrowserRouter , Routes, Route} from 'react-router-dom';
import { HouseBlock } from './individual_games/house_block/house_block';
import { PreGameDefinition } from './individual_games/house_block/pre_game_definition';

function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<AllGamesPage />} />
        <Route path="/houseblock" element={<HouseBlock />} />
        <Route path="/houseblock/pregame_definition" element={<PreGameDefinition />} />
      </Routes>         
    </BrowserRouter>
  );
}

export default App;
